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

import { loadPresets, peekPresets } from './presets.js';

const API_BASE = 'https://taginfo.openstreetmap.org/api/4';

/** How many rows to offer */
export const MAX_SUGGESTIONS = 8;

/** How long to wait after the last keystroke before asking */
const DEBOUNCE_MS = 250;

/** How many lookups to remember, so a long session cannot grow unbounded */
const CACHE_LIMIT = 100;

const cache = new Map();
const tagCounts = new Map();
// Lookups that have been asked for but not yet answered, keyed like tagCounts
const inFlightTagCounts = new Map();
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
 * Pick the filters whose global usage describes how rare a search is.
 *
 * `=` filters are the narrowest thing taginfo can count, so they are preferred;
 * keys on their own are the next best. The other operators (`!=`, `!~`,
 * `missing`) describe what a result is not, which says nothing about how many
 * there are.
 *
 * All of the preferred kind are returned, not just the first, because a search
 * is only as common as its rarest condition: `leisure=swimming_pool
 * swimming_pool=lazy_river` matches a few thousand objects, not the three
 * million the first filter alone would suggest. There are at most two on any
 * curated feature, and their counts are cached.
 * @param {Array<Object>} filters - Filters from tagParser
 * @returns {Array<Object>} The filters to size with, empty when none can be
 */
export function pickEstimateFilters(filters) {
    if (!Array.isArray(filters)) {
        return [];
    }

    const countable = op => filters.filter(filter => filter && filter.key && filter.op === op);
    const values = countable('=');

    return values.length > 0 ? values : countable('exists');
}

/**
 * URL for how often one tag or key is used
 * @param {Object} filter - A '=' or 'exists' filter
 * @returns {string} Request URL
 */
export function buildTagStatsUrl(filter) {
    const isValue = filter.op === '=';
    const url = new URL(`${API_BASE}/${isValue ? 'tag' : 'key'}/stats`);

    url.searchParams.set('key', String(filter.key));
    if (isValue) {
        url.searchParams.set('value', String(filter.value ?? ''));
    }
    return url.toString();
}

/**
 * Read the usage count out of a taginfo stats response, which reports one row
 * per element type plus an 'all' row.
 *
 * Ways and relations are added up rather than the 'all' row being read: this
 * app never asks Postpass or Overpass for nodes, so a tag that is mostly on
 * nodes (attraction=water_slide is 1,717 of them) is rarer here than taginfo's
 * total makes it look, and it is this app's result set that the count is
 * choosing a query shape for.
 * @param {Object} payload - Parsed response
 * @returns {number|null} Uses on ways and relations, or null when unreadable
 */
export function readTagCount(payload) {
    const rows = payload && Array.isArray(payload.data) ? payload.data : [];
    let total = null;

    for (const type of ['ways', 'relations']) {
        const row = rows.find(candidate => candidate && candidate.type === type);
        const count = row ? Number(row.count) : NaN;

        if (Number.isFinite(count) && count >= 0) {
            total = (total ?? 0) + count;
        }
    }

    return total;
}

/**
 * Cache key for a filter whose count has been looked up
 * @param {Object} filter - A '=' or 'exists' filter
 * @returns {string} Cache key
 */
function tagCountKey(filter) {
    return filter.op === '=' ? `${filter.key}=${filter.value ?? ''}` : filter.key;
}

/**
 * Remember a count that arrived without a lookup of our own.
 *
 * A preset carries a baked count, and a taginfo suggestion row the user picked
 * came with one; both are the same number this module would go and ask for, so
 * seeding them means the common path never touches the network at all.
 * @param {Object} filter - The '=' or 'exists' filter the count belongs to
 * @param {number} count - Global uses of that tag
 */
export function seedTagCount(filter, count) {
    const value = Number(count);

    if (!filter || !filter.key || (filter.op !== '=' && filter.op !== 'exists')) {
        return;
    }
    if (!Number.isFinite(value) || value < 0) {
        return;
    }
    rememberTagCount(tagCountKey(filter), value);
}

/**
 * Store a count, evicting the oldest once there are too many
 * @param {string} key - Cache key
 * @param {number} count - The count to keep
 */
function rememberTagCount(key, count) {
    tagCounts.set(key, count);

    while (tagCounts.size > CACHE_LIMIT) {
        // Map iterates in insertion order, so this is the oldest entry
        tagCounts.delete(tagCounts.keys().next().value);
    }
}

/**
 * The count a preset already carries for exactly this tag.
 *
 * `docs/data/presets.json` is generated with a taginfo count baked into every
 * record, so for most of what anyone searches for the number is already on
 * this machine. Consulting it first means the query shape is chosen correctly
 * even when taginfo is unreachable - which is precisely the moment when
 * getting it wrong would leave the user with a query that never finishes.
 *
 * Only single-tag presets count: a multi-tag preset's number is the count of
 * its rarest tag, an upper bound for the preset and not a figure for any one
 * of its tags.
 * @param {Object} filter - A '=' filter
 * @param {Array<Object>|null} presets - The loaded preset records
 * @returns {number|null} The baked count, or null when no preset says
 */
function presetTagCount(filter, presets) {
    if (!Array.isArray(presets) || filter.op !== '=') {
        return null;
    }

    for (const preset of presets) {
        const tags = (preset && preset.tags) || {};
        const keys = Object.keys(tags);
        const count = Number(preset && preset.count);

        if (keys.length === 1 && keys[0] === filter.key && tags[keys[0]] === filter.value
            && !preset.approx && Number.isFinite(count) && count >= 0) {
            return count;
        }
    }
    return null;
}

/**
 * Look up how often one tag is used, asking at most once per tag
 * @param {Object} filter - A '=' or 'exists' filter
 * @param {Object} options - fetchImpl and signal
 * @returns {Promise<number|null>} Uses on ways and relations, or null
 */
async function lookUpTagCount(filter, options) {
    const key = tagCountKey(filter);

    if (tagCounts.has(key)) {
        return tagCounts.get(key);
    }

    // The preset file is local and usually already here; asking it costs
    // nothing and answers most searches without a request at all
    let presets = peekPresets();
    if (!presets) {
        try {
            presets = await loadPresets();
        } catch (error) {
            presets = null;
        }
    }

    const baked = presetTagCount(filter, presets);
    if (baked !== null) {
        rememberTagCount(key, baked);
        return baked;
    }
    // Two filters of one search, or two searches in a row, must not become two
    // requests for the same tag
    if (inFlightTagCounts.has(key)) {
        return inFlightTagCounts.get(key);
    }

    const fetchImpl = options.fetchImpl || fetch;
    const pending = (async () => {
        const response = await fetchImpl(buildTagStatsUrl(filter), {
            signal: options.signal,
            headers: { Accept: 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`taginfo stats request failed: ${response.status}`);
        }

        const count = readTagCount(await response.json());

        // Only a real answer is remembered: a failure now should not decide
        // how every later search on this tag is asked for
        if (count !== null) {
            rememberTagCount(key, count);
        }
        return count;
    })();

    inFlightTagCounts.set(key, pending);
    try {
        return await pending;
    } finally {
        inFlightTagCounts.delete(key);
    }
}

/**
 * Look up how common a search is, to decide how to ask Postpass for it.
 *
 * Answers null rather than rejecting when it simply does not know: no countable
 * filter, or taginfo unreachable. The caller treats that as "common", which is
 * the safe assumption. An abort is different - the caller cancelled on purpose,
 * and a cancelled lookup has no answer to give - so that one is rethrown.
 *
 * With more than one countable filter the smallest count wins: a search is only
 * as common as its rarest condition.
 * @param {Array<Object>} filters - Filters from tagParser
 * @param {Object} [options] - Overrides, mostly for tests
 * @param {Function} [options.fetchImpl] - fetch to use
 * @param {AbortSignal} [options.signal] - Abort signal
 * @returns {Promise<number|null>} Uses of the rarest tag, or null when unknown
 * @throws {Error} AbortError, when the caller aborted the lookup
 */
export async function getTagCount(filters, options = {}) {
    const estimates = pickEstimateFilters(filters);

    if (estimates.length === 0) {
        return null;
    }

    let smallest = null;

    for (const filter of estimates) {
        let count;
        try {
            count = await lookUpTagCount(filter, options);
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw error;
            }
            console.warn('taginfo tag count lookup failed:', error);
            continue;
        }

        // One known count is enough to decide: whatever the others say, the
        // search cannot match more than its rarest tag does
        if (count !== null && (smallest === null || count < smallest)) {
            smallest = count;
        }
    }

    return smallest;
}

/**
 * Forget cached suggestions and any pending lookup (used by tests)
 */
export function resetTaginfoState() {
    cache.clear();
    tagCounts.clear();
    inFlightTagCounts.clear();
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
