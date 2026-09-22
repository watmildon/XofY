/**
 * nominatim.js
 * Looks up the "Y" (area) half of a search with the OpenStreetMap Nominatim
 * geocoder.
 *
 * Nominatim's usage policy forbids autocomplete, so this is only ever called
 * when the user presses Enter or picks the "Search for ..." row - never per
 * keystroke. Requests are spaced at least a second apart, the previous one is
 * aborted, and answers are cached in localStorage.
 *
 * Only relation and way results are useful: `map_to_area` needs an area, which
 * a node cannot give. A closed way (a campus, a theme park) works on Overpass
 * 0.7.57 and later.
 *
 * The parsing and caching helpers take their inputs as arguments so they can be
 * tested in Node; only searchPlaces() touches the network.
 *
 * Geocoding by Nominatim, data (c) OpenStreetMap contributors (ODbL).
 */

const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/** Nominatim asks for at most one request a second */
const MIN_REQUEST_INTERVAL_MS = 1000;

/** How many results to ask for */
const RESULT_LIMIT = 8;

/** localStorage key and bounds for the cache */
const CACHE_KEY = 'xofy-osm-place-cache';
const CACHE_LIMIT = 25;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let lastRequestAt = 0;
let inFlight = null;

/**
 * @typedef {Object} Place
 * @property {string} osmType - 'relation' or 'way'
 * @property {number} osmId - OSM id of the boundary
 * @property {string} label - Full display name
 * @property {string} hint - Short description, such as 'city · ~150 km²'
 */

/**
 * Normalise a query so trivially different spellings share a cache entry
 * @param {string} query - The typed place name
 * @returns {string} Cache key
 */
export function normaliseQuery(query) {
    return String(query ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Kilometres per degree of latitude, near enough for a rough size */
const KM_PER_DEGREE = 111.32;

/**
 * Categories that are lines rather than places. A street matches its name
 * eight times over ("Abbey Road, London") and none of them can become an area,
 * so they are dropped before the user is offered them.
 */
const LINEAR_CATEGORIES = ['highway', 'railway', 'waterway'];

/**
 * Rough size of a Nominatim bounding box, in square kilometres. It is only
 * meant to separate "Nice the city" from "Nice the arrondissement", so the box
 * is treated as flat, with longitudes narrowed by the latitude.
 * @param {Array<string|number>} boundingbox - [minLat, maxLat, minLon, maxLon]
 * @returns {number|null} Area in km2, or null when the box is unusable
 */
export function boundingBoxAreaKm2(boundingbox) {
    if (!Array.isArray(boundingbox) || boundingbox.length < 4) {
        return null;
    }

    const [minLat, maxLat, minLon, maxLon] = boundingbox.map(Number);

    if ([minLat, maxLat, minLon, maxLon].some(value => !Number.isFinite(value))) {
        return null;
    }

    const midLat = (minLat + maxLat) / 2;
    const height = Math.abs(maxLat - minLat) * KM_PER_DEGREE;
    const width = Math.abs(maxLon - minLon) * KM_PER_DEGREE * Math.cos(midLat * Math.PI / 180);
    const area = height * width;

    return area > 0 ? area : null;
}

/**
 * Render an area for a suggestion row, to two significant figures
 * @param {number|null} areaKm2 - Area in square kilometres
 * @returns {string} Something like '~150 km2', or '' when there is nothing to show
 */
export function formatAreaKm2(areaKm2) {
    if (!areaKm2 || !Number.isFinite(areaKm2) || areaKm2 <= 0) {
        return '';
    }

    const rounded = Number(areaKm2.toPrecision(2));
    return `~${rounded.toLocaleString('en-US')} km²`;
}

/**
 * Turn a Nominatim response into the places this app can search in
 * @param {Array<Object>} results - Parsed jsonv2 response
 * @returns {{places: Array<Place>, total: number}} Usable places, and how many
 *     results there were in total (so "only a point" can be explained)
 */
export function mapResults(results) {
    const list = Array.isArray(results) ? results : [];
    const places = [];

    for (const result of list) {
        const osmType = String(result.osm_type || '').toLowerCase();
        const osmId = Number(result.osm_id);

        if ((osmType !== 'relation' && osmType !== 'way') || !Number.isInteger(osmId) || osmId <= 0) {
            continue;
        }
        if (LINEAR_CATEGORIES.includes(String(result.category || '').toLowerCase())) {
            continue;
        }

        const kind = String(result.addresstype || result.type || result.category || '');
        const size = formatAreaKm2(boundingBoxAreaKm2(result.boundingbox));

        places.push({
            osmType,
            osmId,
            label: String(result.display_name || result.name || `${osmType} ${osmId}`),
            // 'city' alone does not separate two same-named boundaries; their
            // sizes do
            hint: [kind, size].filter(Boolean).join(' · ')
        });
    }

    return { places, total: list.length };
}

/**
 * Drop expired and surplus cache entries, oldest first
 * @param {Object} cache - Query to {at, places, total}
 * @param {Object} [options] - Bounds
 * @param {number} [options.limit] - Maximum entries to keep
 * @param {number} [options.ttl] - Maximum age in ms
 * @param {number} [options.now] - Current time in ms
 * @returns {Object} A pruned copy
 */
export function pruneCache(cache, options = {}) {
    const limit = options.limit === undefined ? CACHE_LIMIT : options.limit;
    const ttl = options.ttl === undefined ? CACHE_TTL_MS : options.ttl;
    const now = options.now === undefined ? Date.now() : options.now;

    const entries = Object.entries(cache || {})
        .filter(([, entry]) => entry && typeof entry.at === 'number' && now - entry.at < ttl)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, limit);

    return Object.fromEntries(entries);
}

/**
 * Read the cache out of storage, ignoring anything unreadable
 * @param {Storage} [storage] - Defaults to localStorage
 * @returns {Object} The cache
 */
export function readCache(storage = safeStorage()) {
    if (!storage) {
        return {};
    }

    try {
        const raw = storage.getItem(CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        console.warn('Failed to read the place cache:', e);
        return {};
    }
}

/**
 * Store a result, keeping the cache bounded
 * @param {string} key - Normalised query
 * @param {Object} value - {places, total}
 * @param {Storage} [storage] - Defaults to localStorage
 * @param {number} [now] - Current time in ms
 * @returns {Object} The cache as written
 */
export function writeCache(key, value, storage = safeStorage(), now = Date.now()) {
    const cache = pruneCache({ ...readCache(storage), [key]: { ...value, at: now } }, { now });

    if (storage) {
        try {
            storage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
            console.warn('Failed to store the place cache:', e);
        }
    }

    return cache;
}

/**
 * localStorage, or null where it is unavailable (private mode, tests)
 * @returns {Storage|null} The storage object
 */
function safeStorage() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch (e) {
        return null;
    }
}

/**
 * Build the search URL
 * @param {string} query - The place name to look up
 * @returns {string} Request URL
 */
export function buildSearchUrl(query) {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(RESULT_LIMIT));
    url.searchParams.set('q', query);
    return url.toString();
}

/**
 * Wait until at least MIN_REQUEST_INTERVAL_MS has passed since the last request
 * @returns {Promise<void>} Resolves when it is polite to ask again
 */
function waitForTurn() {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now());
    return wait === 0 ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, wait));
}

/**
 * Look up a place by name
 * @param {string} query - The place name as typed
 * @param {Object} [options] - Overrides, mostly for tests
 * @param {Function} [options.fetchImpl] - fetch to use
 * @param {Storage} [options.storage] - Cache storage
 * @returns {Promise<{places: Array<Place>, total: number, cached: boolean}>} Results
 */
export async function searchPlaces(query, options = {}) {
    const key = normaliseQuery(query);

    if (!key) {
        return { places: [], total: 0, cached: false };
    }

    const storage = options.storage === undefined ? safeStorage() : options.storage;
    const cached = readCache(storage)[key];

    if (cached && Array.isArray(cached.places)) {
        return { places: cached.places, total: cached.total || 0, cached: true };
    }

    // Only the newest search matters
    if (inFlight) {
        inFlight.abort();
    }
    const controller = new AbortController();
    inFlight = controller;

    await waitForTurn();

    if (controller.signal.aborted) {
        throw new DOMException('Search superseded', 'AbortError');
    }

    const doFetch = options.fetchImpl || fetch;
    lastRequestAt = Date.now();

    let response;
    try {
        response = await doFetch(buildSearchUrl(query), {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
    } finally {
        if (inFlight === controller) {
            inFlight = null;
        }
    }

    if (!response.ok) {
        const error = new Error(`Place search failed: ${response.status}`);
        error.status = response.status;
        throw error;
    }

    const mapped = mapResults(await response.json());
    writeCache(key, mapped, storage);

    return { ...mapped, cached: false };
}

/**
 * Forget the rate limiter and the in-flight request (used by tests)
 */
export function resetSearchState() {
    lastRequestAt = 0;
    inFlight = null;
}
