/**
 * sharing.js
 * Encodes the current selection into URL parameters and back again.
 *
 * These functions take plain state objects and return plain state objects, with
 * no DOM access, so they can be imported in Node for tests. main.js keeps the
 * glue that reads the state out of the page and writes it back.
 *
 * Parameters:
 *   feature, area  curated selections, by key (the original format)
 *   x, xl, xt      free-form tag expression, an optional label, and the element
 *                  types when they are not the default `wr`
 *   y, yl          free-form area as <r|w><osm id>, plus an optional label
 *   q              a raw query, base64 of the encoded text (legacy)
 *   lang           `sql` when `q` holds Postpass SQL. A link without it is
 *                  Overpass QL, which is what every link written before the
 *                  Postpass backend existed is
 *   color, scale, gtag   display settings
 *
 * The data source setting is deliberately not shared, for the same reason the
 * Overpass server is not: it is about the recipient's own access to a service,
 * not about the query. A Search-tab link rebuilds itself on whichever backend
 * the recipient uses.
 */

import { DEFAULT_ELEMENT_TYPES } from '../search/queryBuilder.js';

/** Fill colour that needs no `color` parameter */
export const DEFAULT_FILL_COLOR = '#3388ff';

/**
 * Element types a shared link may ask for. Narrower than what the query builder
 * can emit: this app draws shapes, so nodes are never a useful target.
 */
export const SHAREABLE_ELEMENT_TYPES = ['wr', 'way', 'rel'];

/**
 * Encode a free-form area reference as a compact share parameter
 * @param {{osmType: string, osmId: number|string}} ref - Area reference
 * @returns {string|null} Something like 'r170100', or null when not encodable
 */
export function encodeAreaRef(ref) {
    if (!ref) {
        return null;
    }

    const type = String(ref.osmType ?? '').toLowerCase();
    const prefix = type.startsWith('r') ? 'r' : type.startsWith('w') ? 'w' : null;
    const id = Number(ref.osmId);

    if (!prefix || !Number.isInteger(id) || id <= 0) {
        return null;
    }
    return prefix + id;
}

/**
 * Decode a free-form area reference from a share parameter
 * @param {string} text - Something like 'r170100'
 * @returns {{osmType: string, osmId: number}|null} Area reference, or null when invalid
 */
export function decodeAreaRef(text) {
    const match = /^([rw])(\d+)$/.exec(String(text ?? '').trim());

    if (!match) {
        return null;
    }

    const osmId = Number(match[2]);

    if (!Number.isSafeInteger(osmId) || osmId <= 0) {
        return null;
    }
    return { osmType: match[1] === 'r' ? 'relation' : 'way', osmId };
}

/**
 * Check an area reference object, whatever it came from. Storage and URLs are
 * both outside input, so a stored `{osmType: 'node'}` must be rejected here
 * rather than blowing up in the query builder later.
 * @param {Object} ref - Candidate reference
 * @returns {{osmType: string, osmId: number}|null} A clean reference, or null
 */
export function normaliseAreaRef(ref) {
    return decodeAreaRef(encodeAreaRef(ref));
}

/**
 * Encode a raw Overpass query for the `q` parameter
 * @param {string} query - The query text
 * @returns {string} Base64 of the percent-encoded query
 */
function encodeQuery(query) {
    return btoa(encodeURIComponent(query));
}

/**
 * Decode the `q` parameter back into query text
 * @param {string} value - The parameter value
 * @returns {string|null} The query text, or null when it cannot be decoded
 */
function decodeQuery(value) {
    try {
        return decodeURIComponent(atob(value));
    } catch (e) {
        console.warn('Failed to decode query parameter:', e);
        return null;
    }
}

/**
 * Encode application state into URL parameters
 * @param {Object} state - Current state
 * @param {string} [state.tab] - Active tab ('curated', 'overpass', 'import')
 * @param {string} [state.feature] - Curated feature key
 * @param {string} [state.area] - Curated area key
 * @param {string} [state.x] - Free-form tag expression (canonical form)
 * @param {string} [state.xLabel] - Human label for the free-form feature
 * @param {string} [state.xElementTypes] - Element types for the free-form feature
 * @param {{osmType: string, osmId: number}} [state.y] - Free-form area reference
 * @param {string} [state.yLabel] - Human label for the free-form area
 * @param {string} [state.query] - Raw query text
 * @param {string} [state.queryLang] - 'sql' when that text is Postpass SQL
 * @param {string} [state.fillColor] - Fill colour, '#rrggbb'
 * @param {boolean} [state.scaleToggle] - Maintain relative sizes
 * @param {string} [state.groupByTag] - Grouping hint tag
 * @returns {URLSearchParams} The encoded parameters
 */
export function encodeStateToParams(state = {}) {
    const params = new URLSearchParams();

    // X and Y are each either a curated key or a free-form value
    const xParams = state.feature
        ? [['feature', state.feature]]
        : state.x
            ? [
                ['x', state.x],
                ...(state.xLabel ? [['xl', state.xLabel]] : []),
                // Curated features carry their own element types; a free-form
                // one only needs the parameter when it is not the default
                ...(state.xElementTypes && state.xElementTypes !== DEFAULT_ELEMENT_TYPES
                    ? [['xt', state.xElementTypes]]
                    : [])
            ]
            : null;

    const areaRef = state.area ? null : encodeAreaRef(state.y);
    const yParams = state.area
        ? [['area', state.area]]
        : areaRef
            ? [['y', areaRef], ...(state.yLabel ? [['yl', state.yLabel]] : [])]
            : null;

    if (state.tab === 'curated' && xParams && yParams) {
        // Use the feature/area style params for a search selection
        [...xParams, ...yParams].forEach(([key, value]) => params.set(key, value));
    } else if (state.query && state.query.trim()) {
        // Fall back to the raw query for the Query tab
        params.set('q', encodeQuery(state.query));

        // Only SQL needs saying: no parameter means QL, which is what the
        // links written before there was a second language mean
        if (state.queryLang === 'sql') {
            params.set('lang', 'sql');
        }
    }

    if (state.fillColor && state.fillColor !== DEFAULT_FILL_COLOR) {
        params.set('color', state.fillColor.substring(1)); // Remove #
    }

    if (state.scaleToggle) {
        params.set('scale', '1');
    }

    if (state.groupByTag && state.groupByTag.trim()) {
        params.set('gtag', state.groupByTag.trim());
    }

    return params;
}

/**
 * Build a shareable URL for the current state
 * @param {Object} state - Current state (see encodeStateToParams)
 * @param {string} href - The URL to rewrite the query string of
 * @returns {string} The shareable URL
 */
export function buildShareURL(state, href) {
    const url = new URL(href);
    url.search = encodeStateToParams(state).toString();
    return url.toString();
}

/**
 * Decode URL parameters into application state
 * @param {string|URLSearchParams} search - A query string (with or without '?')
 * @returns {Object|null} The decoded state, or null when there are no parameters
 */
export function decodeParamsToState(search) {
    const params = search instanceof URLSearchParams
        ? search
        : new URLSearchParams(search || '');

    if (params.toString() === '') {
        return null;
    }

    const state = {};

    // Curated selections
    if (params.has('feature')) {
        state.feature = params.get('feature');
    }
    if (params.has('area')) {
        state.area = params.get('area');
    }

    // Free-form feature (X)
    if (params.get('x')) {
        state.x = params.get('x');
        if (params.get('xl')) {
            state.xLabel = params.get('xl');
        }
        if (params.has('xt')) {
            const elementTypes = params.get('xt');
            if (SHAREABLE_ELEMENT_TYPES.includes(elementTypes)) {
                state.xElementTypes = elementTypes;
            } else {
                console.warn('Ignoring unrecognised element types parameter:', elementTypes);
            }
        }
    }

    // Free-form area (Y)
    if (params.has('y')) {
        const ref = decodeAreaRef(params.get('y'));
        if (ref) {
            state.y = ref;
            if (params.get('yl')) {
                state.yLabel = params.get('yl');
            }
        } else {
            console.warn('Ignoring unrecognised area parameter:', params.get('y'));
        }
    }

    // Raw query (legacy format)
    if (params.has('q')) {
        const query = decodeQuery(params.get('q'));
        if (query !== null) {
            state.query = query;
            // A link that does not say is Overpass QL: that is what every
            // link made before the Postpass backend carries
            state.queryLang = params.get('lang') === 'sql' ? 'sql' : 'ql';
        }
    }

    // Decode color
    if (params.has('color')) {
        state.fillColor = '#' + params.get('color');
    }

    // Decode scale toggle
    if (params.has('scale')) {
        state.scaleToggle = params.get('scale') === '1';
    }

    // Decode group by tag
    if (params.has('gtag')) {
        state.groupByTag = params.get('gtag');
    }

    return state;
}
