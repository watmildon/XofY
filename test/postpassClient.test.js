/**
 * postpassClient.test.js
 * Tests for the Postpass request body, the timeout, and what an error becomes.
 * No network: the fetch is always a stand-in.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    executeSql,
    buildPostpassBody,
    describePostpassError,
    readCountResult,
    setPostpassTimeout,
    getPostpassTimeout,
    DEFAULT_POSTPASS_URL,
    POSTPASS_TIMEOUT_MS
} from '../docs/js/postpassClient.js';

const SQL = "SELECT p.osm_type, p.osm_id, p.tags, p.geom\nFROM postpass_linepolygon p\nWHERE p.tags @> '{\"leisure\":\"park\"}'::jsonb";

/**
 * A fetch stand-in that answers with one prepared response
 * @param {Object} response - What to answer with
 * @param {Array} calls - Collects the arguments it was called with
 * @returns {Function} The stand-in
 */
function respondWith(response, calls = []) {
    return async (url, options) => {
        calls.push({ url, options });
        return response;
    };
}

test('posts the query as a simple form request', async () => {
    const calls = [];
    const payload = { type: 'FeatureCollection', features: [] };

    const result = await executeSql(SQL, {
        fetchImpl: respondWith({ ok: true, status: 200, json: async () => payload }, calls)
    });

    assert.deepEqual(result, payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, DEFAULT_POSTPASS_URL);
    assert.equal(calls[0].options.method, 'POST');

    // A preflight would fail, so the request has to stay "simple": one known
    // content type and no headers of our own
    assert.deepEqual(calls[0].options.headers, { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.equal(new URLSearchParams(calls[0].options.body).get('q'), SQL);
    assert.equal(new URLSearchParams(calls[0].options.body).get('options[geojson]'), null);
    assert.ok(calls[0].options.signal);
});

test('asks for plain rows when the answer is a count', async () => {
    const calls = [];

    await executeSql('SELECT count(*) AS total FROM t', {
        geojson: false,
        fetchImpl: respondWith({ ok: true, status: 200, json: async () => ({ result: [{ total: 7 }] }) }, calls)
    });

    assert.equal(new URLSearchParams(calls[0].options.body).get('options[geojson]'), 'false');
});

test('builds the body the server expects', () => {
    assert.equal(buildPostpassBody('SELECT 1'), 'q=SELECT+1');
    assert.equal(buildPostpassBody('SELECT 1', false), 'q=SELECT+1&options%5Bgeojson%5D=false');

    // Everything a query can hold survives the encoding
    const awkward = "SELECT * WHERE tags @> '{\"name\":\"A&B\"}'::jsonb -- ;\n";
    assert.equal(new URLSearchParams(buildPostpassBody(awkward)).get('q'), awkward);
});

test('refuses an empty query without asking the server', async () => {
    const never = async () => { throw new Error('should not have been called'); };

    await assert.rejects(() => executeSql('', { fetchImpl: never }), /cannot be empty/);
    await assert.rejects(() => executeSql('   \n', { fetchImpl: never }), /cannot be empty/);
    await assert.rejects(() => executeSql(undefined, { fetchImpl: never }), /cannot be empty/);
});

test('a rejected query is reported in the database\'s own words', async () => {
    const error = await executeSql(SQL, {
        fetchImpl: respondWith({
            ok: false,
            status: 400,
            text: async () => 'pq: syntax error at or near "SELEC"'
        })
    }).catch(e => e);

    assert.equal(error.message, 'syntax error at or near "SELEC"');
    assert.equal(error.status, 400);
    assert.equal(error.sqlError, true, 'the user can fix this one by editing the query');
});

test('an outage says so, and is not the user\'s fault', async () => {
    const down = await executeSql(SQL, {
        fetchImpl: respondWith({ ok: false, status: 503, text: async () => '' })
    }).catch(e => e);

    assert.equal(down.message, 'Postpass is unavailable (503)');
    assert.equal(down.status, 503);
    assert.equal(down.sqlError, false);

    // A body we cannot read must not lose the status
    const unreadable = await executeSql(SQL, {
        fetchImpl: respondWith({ ok: false, status: 502, text: async () => { throw new Error('no body'); } })
    }).catch(e => e);
    assert.equal(unreadable.message, 'Postpass is unavailable (502)');

    const odd = await executeSql(SQL, {
        fetchImpl: respondWith({ ok: false, status: 429, text: async () => 'slow down' })
    }).catch(e => e);
    assert.equal(odd.message, 'Postpass error 429: slow down');
    assert.equal(odd.sqlError, false);
});

test('the same complaint from several workers is said once', async () => {
    // A query that fails once rows are already being produced fails in every
    // worker, and each one adds its own prefixed line. This is the real body
    // for `SELECT 1 AS x`, which selects no geometry column
    const body = 'pq: geometry column is missing\npq: geometry column is missing';

    assert.equal(describePostpassError(400, body), 'geometry column is missing');

    const error = await executeSql('SELECT 1 AS x', {
        fetchImpl: respondWith({ ok: false, status: 400, text: async () => body })
    }).catch(e => e);

    assert.equal(error.message, 'geometry column is missing');
    assert.equal(error.sqlError, true);

    // Two genuinely different lines are both worth reading
    assert.equal(
        describePostpassError(400, 'pq: first thing\npq: second thing\npq: first thing'),
        'first thing\nsecond thing'
    );
    // Blank lines and a trailing newline add nothing
    assert.equal(describePostpassError(400, 'pq: only thing\n\n'), 'only thing');
});

test('describes each kind of failure on its own', () => {
    assert.equal(describePostpassError(400, 'pq: relation "nope" does not exist'), 'relation "nope" does not exist');
    assert.equal(describePostpassError(400, '  pq:   spaced  '), 'spaced');
    assert.equal(describePostpassError(400, ''), 'Postpass error: 400');
    assert.equal(describePostpassError(500, 'anything'), 'Postpass is unavailable (500)');
    assert.equal(describePostpassError(503, ''), 'Postpass is unavailable (503)');
    assert.equal(describePostpassError(404, ''), 'Postpass error: 404');
    assert.equal(describePostpassError(404, undefined), 'Postpass error: 404');
});

test('the client is the one that gives up, because the server will not', async () => {
    // Postpass has a ten-hour server-side timeout, so a request that is not
    // abandoned here is simply never answered
    assert.equal(POSTPASS_TIMEOUT_MS, 60000);

    const hangs = (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
    });

    const error = await executeSql(SQL, { fetchImpl: hangs, timeoutMs: 5 }).catch(e => e);

    assert.match(error.message, /Postpass did not answer in time/);
    assert.equal(error.timeout, true);
    assert.equal(error.status, 0);
});

/**
 * A fetch stand-in whose headers arrive at once but whose body never does,
 * which is what a connection dropped mid-answer looks like
 * @param {Object} [response] - Fields to put on the response besides the body
 * @returns {Function} The stand-in
 */
function headersOnly(response = { ok: true, status: 200 }) {
    return async (url, options) => {
        const stall = () => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
        });
        return { ...response, json: stall, text: stall };
    };
}

test('the deadline covers the body, not only the headers', async () => {
    // A 2 MB answer is streamed, so the request is far from over when the
    // headers arrive; a connection that dies after them used to hang forever
    const error = await executeSql(SQL, { fetchImpl: headersOnly(), timeoutMs: 5 }).catch(e => e);

    assert.match(error.message, /Postpass did not answer in time/);
    assert.equal(error.timeout, true);
    assert.equal(error.status, 0);

    // An error response whose body stalls is reported the same way, rather
    // than as a bare status with no message
    const failing = await executeSql(SQL, {
        fetchImpl: headersOnly({ ok: false, status: 400 }),
        timeoutMs: 5
    }).catch(e => e);
    assert.equal(failing.timeout, true);
});

test('a caller can still abort once the body has started', async () => {
    const controller = new AbortController();
    const pending = executeSql(SQL, {
        fetchImpl: headersOnly(),
        signal: controller.signal
    }).catch(e => e);

    // Let the headers arrive before changing our mind
    await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();

    const error = await pending;
    assert.equal(error.name, 'AbortError');
    assert.equal(error.status, 0);
    assert.notEqual(error.timeout, true);
});

test('the caller can abort a request of its own accord', async () => {
    const hangs = (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
    });

    const controller = new AbortController();
    const pending = executeSql(SQL, { fetchImpl: hangs, signal: controller.signal }).catch(e => e);
    controller.abort();

    const error = await pending;
    assert.equal(error.name, 'AbortError', 'a superseded request is not a failure to report');
    assert.notEqual(error.timeout, true);
    // Everything this throws carries a status, so the caller need not check
    assert.equal(error.status, 0);

    // A signal that was already aborted stops the request just as well
    const already = AbortSignal.abort();
    const second = await executeSql(SQL, { fetchImpl: hangs, signal: already }).catch(e => e);
    assert.equal(second.name, 'AbortError');
});

test('a network failure reads as one', async () => {
    const error = await executeSql(SQL, {
        fetchImpl: async () => { throw new TypeError('Failed to fetch'); }
    }).catch(e => e);

    assert.match(error.message, /Network error/);
    assert.equal(error.status, 0);
});

test('a shorter deadline can be asked for, but not an unusable one', () => {
    assert.equal(getPostpassTimeout(), POSTPASS_TIMEOUT_MS, 'a minute until someone says otherwise');

    try {
        setPostpassTimeout(5000);
        assert.equal(getPostpassTimeout(), 5000);

        // The only caller reads a URL parameter, so a link carrying a deadline
        // nothing could meet must not leave the page unable to run anything
        setPostpassTimeout(1);
        assert.equal(getPostpassTimeout(), 1000);
        setPostpassTimeout(999);
        assert.equal(getPostpassTimeout(), 1000);

        // Nonsense changes nothing at all
        for (const bad of [0, -5, NaN, 'soon', null, undefined, {}]) {
            setPostpassTimeout(bad);
            assert.equal(getPostpassTimeout(), 1000, String(bad));
        }
    } finally {
        setPostpassTimeout(POSTPASS_TIMEOUT_MS);
    }
    assert.equal(getPostpassTimeout(), POSTPASS_TIMEOUT_MS);
});

test('reads the total out of a counting answer', () => {
    assert.equal(readCountResult({ result: [{ total: 4956 }] }), 4956);
    assert.equal(readCountResult({ result: [{ total: '4956' }] }), 4956);
    assert.equal(readCountResult({ result: [{ total: 0 }] }), 0);
    assert.equal(readCountResult({ result: [] }), null);
    assert.equal(readCountResult({ result: [{}] }), null);
    assert.equal(readCountResult({}), null);
    assert.equal(readCountResult(null), null);
});
