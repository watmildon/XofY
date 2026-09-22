/**
 * postpassClient.js
 * Handles communication with Postpass, Geofabrik's PostGIS OSM API.
 *
 * The request has to stay a CORS "simple request" - POST, form-urlencoded, no
 * headers of our own - because the server answers no preflight. That is also
 * why nothing here identifies the app: any extra header would break it.
 *
 * Postpass has no practical server-side timeout (a query may run for hours), so
 * unlike Overpass the giving up is entirely the client's job.
 *
 * Queries by Postpass (Geofabrik), data (c) OpenStreetMap contributors (ODbL).
 */

export const DEFAULT_POSTPASS_URL = 'https://postpass.geofabrik.de/api/interpreter';

/** How long to wait for an answer before abandoning the request */
export const POSTPASS_TIMEOUT_MS = 60000;

// The deadline actually in force. It is a minute in the app and never changes
// there; a browser test that has to see what a hung request looks like would
// otherwise have to sit through a real one
let currentTimeoutMs = POSTPASS_TIMEOUT_MS;

/** No deadline shorter than this, whoever asks for one */
const MIN_TIMEOUT_MS = 1000;

/**
 * Change how long to wait before giving up.
 *
 * Clamped, because the only caller reads a URL parameter: a link carrying
 * `?postpassTimeout=1` would otherwise leave whoever opened it with a page on
 * which no query can ever finish, and nothing to suggest why.
 * @param {number} ms - The new deadline, in milliseconds
 */
export function setPostpassTimeout(ms) {
    const value = Number(ms);

    if (Number.isFinite(value) && value > 0) {
        currentTimeoutMs = Math.max(value, MIN_TIMEOUT_MS);
    }
}

/**
 * How long a request currently waits before giving up
 * @returns {number} The deadline, in milliseconds
 */
export function getPostpassTimeout() {
    return currentTimeoutMs;
}

/**
 * Build the form body for a query
 * @param {string} sql - A single SELECT statement, with no trailing semicolon
 * @param {boolean} [geojson] - False asks for plain rows instead of GeoJSON
 * @returns {string} An application/x-www-form-urlencoded body
 */
export function buildPostpassBody(sql, geojson = true) {
    const body = new URLSearchParams();

    body.set('q', sql);
    // The option is only sent when it changes something: GeoJSON is the default
    if (!geojson) {
        body.set('options[geojson]', 'false');
    }
    return body.toString();
}

/**
 * Turn an error response into something worth showing a person.
 *
 * A failed query comes back as HTTP 400 with the database's own message in the
 * body, prefixed `pq:`. That prefix is the Go driver's and means nothing to the
 * reader, so it goes; the rest ("syntax error at or near ...") is the most
 * useful thing there is to say about a query the user can edit.
 *
 * An error raised while a worker is already producing rows arrives once per
 * worker, so the body is the same prefixed line repeated - `SELECT 1 AS x`
 * answers "pq: geometry column is missing" twice. Each line is stripped and the
 * repeats are collapsed, because being told the same thing twice reads like two
 * different things having gone wrong.
 * @param {number} status - HTTP status
 * @param {string} body - Response body, if it was readable
 * @returns {string} A plain message
 */
export function describePostpassError(status, body) {
    const lines = String(body ?? '')
        .split('\n')
        .map(line => line.trim().replace(/^pq:\s*/, ''))
        .filter(line => line !== '');
    const message = [...new Set(lines)].join('\n');

    if (status === 400 && message) {
        return message;
    }
    if (status >= 500) {
        return `Postpass is unavailable (${status})`;
    }
    return message ? `Postpass error ${status}: ${message}` : `Postpass error: ${status}`;
}

/**
 * Read the answer to a counting query, which is asked for as plain rows
 * @param {Object} payload - Parsed response body ({result: [{total}]})
 * @returns {number|null} The count, or null when the response has none
 */
export function readCountResult(payload) {
    const rows = payload && Array.isArray(payload.result) ? payload.result : [];
    const total = rows.length > 0 ? Number(rows[0].total) : NaN;

    return Number.isFinite(total) ? total : null;
}

/**
 * Execute one Postpass SQL query
 * @param {string} sql - A single SELECT statement, with no trailing semicolon
 * @param {Object} [options] - Request options
 * @param {boolean} [options.geojson] - False asks for plain rows (used by counts)
 * @param {AbortSignal} [options.signal] - Abort signal of the caller's own
 * @param {string} [options.apiUrl] - Endpoint to use
 * @param {number} [options.timeoutMs] - How long to wait before giving up
 * @param {Function} [options.fetchImpl] - fetch to use
 * @returns {Promise<Object>} The parsed JSON response
 * @throws {Error} With `.status` (0 when no answer arrived), `.timeout` when it
 *     was this client that gave up, and `.sqlError` when the query itself is
 *     what the server rejected
 */
export async function executeSql(sql, options = {}) {
    if (!sql || sql.trim() === '') {
        throw new Error('Query cannot be empty');
    }

    const {
        geojson = true,
        signal,
        apiUrl = DEFAULT_POSTPASS_URL,
        timeoutMs = getPostpassTimeout(),
        fetchImpl = fetch
    } = options;

    // A request the caller has already given up on is not worth sending, and
    // starting a timer for it would only leave one running
    if (signal && signal.aborted) {
        throw Object.assign(new Error('Request aborted'), { name: 'AbortError', status: 0 });
    }

    // One controller for both reasons to stop: our own deadline, and whatever
    // the caller may abort for. AbortSignal.any would do this in one line, but
    // it is younger than the browsers this page still runs in
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    if (signal) {
        signal.addEventListener('abort', onCallerAbort);
    }

    /**
     * What a request that never produced an answer should be reported as
     * @param {Error} error - Whatever fetch or the body read rejected with
     * @returns {Error} The error to throw
     */
    const requestFailure = (error) => {
        if (timedOut) {
            const timeout = new Error(
                `Postpass did not answer in time (${Math.round(timeoutMs / 1000)} seconds)`
            );
            timeout.status = 0;
            timeout.timeout = true;
            return timeout;
        }
        if (error && error.name === 'AbortError') {
            // Superseded rather than failed, but the caller reads `.status` on
            // everything this throws
            error.status = 0;
            return error;
        }

        const network = new Error('Network error. Please check your connection and try again.');
        network.status = 0;
        return network;
    };

    // The deadline has to cover the body as well as the headers: a 2 MB answer
    // is streamed, and a connection that dies after the headers would otherwise
    // leave the read hanging with nothing left to abort it
    try {
        let response;
        try {
            response = await fetchImpl(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: buildPostpassBody(sql, geojson),
                signal: controller.signal
            });
        } catch (error) {
            throw requestFailure(error);
        }

        if (!response.ok) {
            // The body carries the database's message; not being able to read
            // it must not replace the status with something less informative,
            // unless the reason it could not be read is that we gave up
            let body = '';
            try {
                body = await response.text();
            } catch (error) {
                if (timedOut || controller.signal.aborted) {
                    throw requestFailure(error);
                }
                body = '';
            }

            const error = new Error(describePostpassError(response.status, body));
            error.status = response.status;
            error.sqlError = response.status === 400 && body.trim() !== '';
            throw error;
        }

        try {
            return await response.json();
        } catch (error) {
            throw requestFailure(error);
        }
    } finally {
        clearTimeout(timer);
        if (signal) {
            signal.removeEventListener('abort', onCallerAbort);
        }
    }
}
