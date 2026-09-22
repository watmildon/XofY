/**
 * taginfo.js
 * Suggests OSM tag keys and values, with how often each is used, from taginfo.
 *
 * Lookups are debounced, the previous one is aborted, and answers are cached in
 * memory for the life of the page. A failure is never fatal: the caller gets an
 * empty list and simply shows no "Tags" group, so typing and Enter keep working
 * whatever taginfo is doing.
 *
 * The parsing and formatting helpers take their inputs as arguments so they can
 * be tested in Node; only requestSuggestions() touches the network.
 *
 * Tag usage counts from taginfo, (c) OpenStreetMap contributors.
 */

const API_BASE = 'https://taginfo.openstreetmap.org/api/4';

/** How many rows to offer */
export const MAX_SUGGESTIONS = 8;

/** How long to wait after the last keystroke before asking */
const DEBOUNCE_MS = 250;

/** How many lookups to remember, so a long session cannot grow unbounded */
const CACHE_LIMIT = 100;

const cache = new Map();
let debounceTimer = null;
let activeController = null;
let waiting = null;

/**
 * Render a usage count compactly: 3.0M, 157k, 942
 * @param {number} count - Number of uses
 * @returns {string} Short form, or '' when there is no count
 */
export function formatCount(count) {
    const value = Number(count);

    if (!Number.isFinite(value) || value < 0) {
        return '';
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 100_000) {
        return `${Math.round(value / 1000)}k`;
    }
    if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}k`;
    }
    return String(Math.round(value));
}

/**
 * URL for the key suggestions
 * @param {string} query - Partial key
 * @returns {string} Request URL
 */
export function buildKeysUrl(query) {
    const url = new URL(`${API_BASE}/keys/all`);
    url.searchParams.set('query', query);
    url.searchParams.set('sortname', 'count_all');
    url.searchParams.set('sortorder', 'desc');
    url.searchParams.set('rp', String(MAX_SUGGESTIONS));
    // taginfo ignores rp without a page, and answers 412 on some endpoints
    url.searchParams.set('page', '1');
    url.searchParams.set('filter', 'in_wiki');
    return url.toString();
}

/**
 * URL for the value suggestions of one key
 * @param {string} key - The tag key
 * @param {string} query - Partial value
 * @returns {string} Request URL
 */
export function buildValuesUrl(key, query) {
    const url = new URL(`${API_BASE}/key/values`);
    url.searchParams.set('key', key);
    url.searchParams.set('query', query);
    url.searchParams.set('sortname', 'count');
    url.searchParams.set('sortorder', 'desc');
    url.searchParams.set('rp', String(MAX_SUGGESTIONS));
    url.searchParams.set('page', '1');
    return url.toString();
}

/**
 * Read the key rows out of a taginfo response
 * @param {Object} payload - Parsed response
 * @param {number} [limit] - How many to keep
 * @returns {Array<{key: string, count: number}>} Suggestions, most used first
 */
export function mapKeys(payload, limit = MAX_SUGGESTIONS) {
    const rows = payload && Array.isArray(payload.data) ? payload.data : [];

    return rows
        .filter(row => row && row.key && Number(row.count_all) > 0)
        .map(row => ({ key: String(row.key), count: Number(row.count_all) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

/**
 * Read the value rows out of a taginfo response. taginfo matches the query
 * anywhere in the value, so the rows are re-ordered to put the ones that start
 * with what was typed first - `building=c` should offer commercial and church
 * before detached.
 * @param {Object} payload - Parsed response
 * @param {string} key - The key the values belong to
 * @param {string} [query] - What the user has typed of the value
 * @param {number} [limit] - How many to keep
 * @returns {Array<{key: string, value: string, count: number}>} Suggestions
 */
export function mapValues(payload, key, query = '', limit = MAX_SUGGESTIONS) {
    const rows = payload && Array.isArray(payload.data) ? payload.data : [];
    const typed = String(query ?? '').toLowerCase();
    const startsWithTyped = (value) => (typed ? value.toLowerCase().startsWith(typed) : true);

    return rows
        .filter(row => row && row.value && Number(row.count) > 0)
        .map(row => ({ key, value: String(row.value), count: Number(row.count) }))
        .sort((a, b) => (startsWithTyped(b.value) - startsWithTyped(a.value)) || (b.count - a.count))
        .slice(0, limit);
}

/**
 * Cache key for a typing context, or null when there is nothing to look up
 * @param {Object} context - From tagParser.getTypingContext
 * @returns {string|null} Cache key
 */
export function cacheKeyFor(context) {
    if (!context) {
        return null;
    }
    if (context.field === 'value') {
        return context.key ? `value:${context.key}:${context.partial || ''}` : null;
    }
    // An empty key fragment would ask taginfo for the whole tag list
    return context.partial ? `key:${context.partial}` : null;
}

/**
 * Suggestions already in memory for this context
 * @param {Object} context - From tagParser.getTypingContext
 * @returns {Array<Object>|undefined} The rows, or undefined when not looked up yet
 */
export function peekSuggestions(context) {
    const key = cacheKeyFor(context);
    return key ? cache.get(key) : undefined;
}

/**
 * Store a result, dropping the oldest once the cache is full
 * @param {string} key - Cache key
 * @param {Array<Object>} rows - Suggestions to remember
 */
function remember(key, rows) {
    cache.set(key, rows);

    while (cache.size > CACHE_LIMIT) {
        // Map iterates in insertion order, so this is the oldest entry
        cache.delete(cache.keys().next().value);
    }
}

/**
 * Fetch one page of suggestions
 * @param {Object} context - From tagParser.getTypingContext
 * @param {AbortSignal} signal - Abort signal
 * @param {Function} fetchImpl - fetch to use
 * @returns {Promise<Array<Object>>} Suggestions
 */
async function fetchSuggestions(context, signal, fetchImpl) {
    const isValue = context.field === 'value';
    const url = isValue
        ? buildValuesUrl(context.key, context.partial || '')
        : buildKeysUrl(context.partial || '');

    const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });

    if (!response.ok) {
        throw new Error(`taginfo request failed: ${response.status}`);
    }

    const payload = await response.json();
    return isValue ? mapValues(payload, context.key, context.partial || '') : mapKeys(payload);
}

/**
 * Look up suggestions for what is being typed. Resolves with an empty list
 * rather than rejecting, so a taginfo outage costs nothing.
 * @param {Object} context - From tagParser.getTypingContext
 * @param {Object} [options] - Overrides, mostly for tests
 * @param {Function} [options.fetchImpl] - fetch to use
 * @param {number} [options.debounceMs] - Debounce delay
 * @returns {Promise<Array<Object>>} Suggestions, possibly empty
 */
export function requestSuggestions(context, options = {}) {
    const key = cacheKeyFor(context);

    if (!key) {
        return Promise.resolve([]);
    }
    if (cache.has(key)) {
        return Promise.resolve(cache.get(key));
    }

    // Supersede whatever was queued or in flight
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    if (waiting) {
        waiting.resolve([]);
        waiting = null;
    }
    if (activeController) {
        activeController.abort();
        activeController = null;
    }

    const delay = options.debounceMs === undefined ? DEBOUNCE_MS : options.debounceMs;
    const fetchImpl = options.fetchImpl || fetch;

    return new Promise((resolve) => {
        waiting = { resolve };

        debounceTimer = setTimeout(async () => {
            const mine = waiting;
            waiting = null;
            debounceTimer = null;

            const controller = new AbortController();
            activeController = controller;

            try {
                const rows = await fetchSuggestions(context, controller.signal, fetchImpl);
                remember(key, rows);
                mine.resolve(rows);
            } catch (error) {
                if (!error || error.name !== 'AbortError') {
                    console.warn('taginfo lookup failed:', error);
                }
                mine.resolve([]);
            } finally {
                if (activeController === controller) {
                    activeController = null;
                }
            }
        }, delay);
    });
}

/**
 * Forget cached suggestions and any pending lookup (used by tests)
 */
export function resetTaginfoState() {
    cache.clear();
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (waiting) {
        waiting.resolve([]);
        waiting = null;
    }
    activeController = null;
}
