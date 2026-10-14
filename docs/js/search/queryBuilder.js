/**
 * queryBuilder.js
 * Builds Overpass QL from a parsed feature (X) and area (Y) selection.
 *
 * The generated shape matches what the app has always produced:
 *
 *     [out:json][timeout:60];
 *     rel(170100);
 *     map_to_area->.searchArea;
 *     wr(area.searchArea)["leisure"="swimming_pool"];
 *     out geom;
 *
 * Pure logic: no DOM and no network, so it can be imported in Node for tests.
 */

/** Default Overpass server-side timeout, in seconds */
export const DEFAULT_TIMEOUT = 60;

/** Default element types: ways and relations (nodes have no interesting geometry) */
export const DEFAULT_ELEMENT_TYPES = 'wr';

/**
 * Element types a sub-feature is searched as: nodes, ways and relations,
 * whatever the main feature's own selector, since a parking space is drawn
 * inside a lot whichever kind of element either is - and a tree in a park is
 * a node, drawn as a dot
 */
export const SUB_FEATURE_ELEMENT_TYPES = 'nwr';

/** Element type selectors we are willing to emit */
const ALLOWED_ELEMENT_TYPES = ['wr', 'way', 'rel', 'nwr', 'nw', 'node'];

/**
 * Check whether a value is an element type selector this module will emit
 * @param {string} elementTypes - Candidate selector
 * @returns {boolean} True when it is safe to use
 */
export function isSupportedElementTypes(elementTypes) {
    return ALLOWED_ELEMENT_TYPES.includes(elementTypes);
}

/**
 * Escape a string for use inside an Overpass QL double-quoted literal.
 * A typed quote or backslash must never be able to break out of the literal.
 * @param {string} value - Raw key or value text
 * @returns {string} Escaped text (without the surrounding quotes)
 */
export function escapeQLString(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

/**
 * Render one tag filter as an Overpass QL selector
 * @param {Object} filter - Filter from tagParser ({key, op, value})
 * @returns {string} A selector such as ["leisure"="park"]
 */
export function formatFilter(filter) {
    if (!filter || !filter.key) {
        throw new Error('Tag filter is missing a key');
    }

    const key = escapeQLString(filter.key);

    switch (filter.op) {
        case 'exists':
            return `["${key}"]`;
        case 'missing':
            return `[!"${key}"]`;
        case '=':
        case '!=':
        case '~':
        case '!~':
            return `["${key}"${filter.op}"${escapeQLString(filter.value)}"]`;
        default:
            throw new Error(`Unsupported tag filter operator: ${filter.op}`);
    }
}

/**
 * Render a list of tag filters as a single Overpass QL selector chain
 * @param {Array<Object>} filters - Filters from tagParser
 * @returns {string} Concatenated selectors
 */
export function formatFilters(filters) {
    if (!Array.isArray(filters)) {
        return '';
    }
    return filters.map(formatFilter).join('');
}

/**
 * Normalise an OSM element type to the keyword Overpass expects
 * @param {string} osmType - 'relation', 'rel', 'r', 'way' or 'w'
 * @returns {string} 'rel' or 'way'
 * @throws {Error} For anything else, including nodes, which have no area
 */
export function normaliseOsmType(osmType) {
    const type = String(osmType ?? '').toLowerCase();

    if (type === 'way' || type === 'w') {
        return 'way';
    }
    if (type === 'relation' || type === 'rel' || type === 'r') {
        return 'rel';
    }
    throw new Error(`Unsupported OSM area type: ${osmType}`);
}

/**
 * Validate an OSM id so it can never carry QL of its own
 * @param {number|string} osmId - The id to validate
 * @returns {number} The id as a positive integer
 * @throws {Error} When the id is not a positive integer
 */
export function normaliseOsmId(osmId) {
    const id = typeof osmId === 'number' ? osmId : Number(String(osmId).trim());

    if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`Invalid OSM id: ${osmId}`);
    }
    return id;
}

/**
 * Build an Overpass query
 * @param {Object} options - Query options
 * @param {Array<Object>} [options.filters] - Tag filters from tagParser
 * @param {string} [options.rawTagExpression] - Ready-made QL selectors, used instead of
 *     filters. WARNING: this text is inserted verbatim, so it is only for the
 *     hand-written curated selectors in config/features.js. Anything derived
 *     from user input must go through `filters`, which escapes it.
 * @param {string} [options.elementTypes] - Element selector ('wr', 'way', 'rel')
 * @param {{osmType: string, osmId: number}|null} [options.area] - Area to search, or null for the world
 * @param {number|null} [options.timeout] - Timeout in seconds, or null to omit the setting
 * @param {'geom'|'count'} [options.output] - Output statement to append
 * @param {Array<Object>|null} [options.subFilters] - Tag filters for the
 *     sub-features to fetch alongside the main feature (parking spaces with
 *     parking lots, say). They are searched in the same area, as nodes, ways
 *     and relations - a tree in a park is a node, and is drawn as a dot - and
 *     the two selectors become a union. Which element is which is worked out
 *     afterwards from its tags. A count never includes them: the
 *     guardrail sizes what will be drawn as items, and sub-features are drawn
 *     inside those.
 * @returns {string} Overpass QL query
 */
export function buildOverpassQuery(options = {}) {
    const {
        filters = [],
        rawTagExpression = null,
        elementTypes = DEFAULT_ELEMENT_TYPES,
        area = null,
        timeout = DEFAULT_TIMEOUT,
        output = 'geom',
        subFilters = null
    } = options;

    if (!isSupportedElementTypes(elementTypes)) {
        throw new Error(`Unsupported element types: ${elementTypes}`);
    }
    if (output !== 'geom' && output !== 'count') {
        throw new Error(`Unsupported output mode: ${output}`);
    }
    if (timeout !== null && timeout !== undefined && !(Number.isInteger(timeout) && timeout > 0)) {
        throw new Error(`Invalid timeout: ${timeout}`);
    }

    const tags = typeof rawTagExpression === 'string' ? rawTagExpression : formatFilters(filters);
    const subTags = output === 'geom' && Array.isArray(subFilters) && subFilters.length > 0
        ? formatFilters(subFilters)
        : null;
    const settings = timeout === null || timeout === undefined
        ? '[out:json]'
        : `[out:json][timeout:${timeout}]`;
    const outStatement = output === 'count' ? 'out count;' : 'out geom;';

    /**
     * The statement(s) that select what to output: one selector, or a union
     * of the main one and the sub-feature one
     * @param {string} where - The area clause, '' for the world
     * @returns {string} The selection lines, newline terminated
     */
    const selection = (where) => {
        if (subTags === null) {
            return `${elementTypes}${where}${tags};\n`;
        }
        return `(
  ${elementTypes}${where}${tags};
  ${SUB_FEATURE_ELEMENT_TYPES}${where}${subTags};
);\n`;
    };

    // World query - no area filter
    if (!area || area.osmId === null || area.osmId === undefined) {
        return `${settings};
${selection('')}${outStatement}`;
    }

    const areaType = normaliseOsmType(area.osmType);
    const areaId = normaliseOsmId(area.osmId);

    return `${settings};
${areaType}(${areaId});
map_to_area->.searchArea;
${selection('(area.searchArea)')}${outStatement}`;
}

/**
 * Build the `out geom;` variant of a query
 * @param {Object} options - Options for buildOverpassQuery
 * @returns {string} Overpass QL query
 */
export function buildGeomQuery(options = {}) {
    return buildOverpassQuery({ ...options, output: 'geom' });
}

/**
 * Build the `out count;` variant of a query, used to size a result set first
 * @param {Object} options - Options for buildOverpassQuery
 * @returns {string} Overpass QL query
 */
export function buildCountQuery(options = {}) {
    return buildOverpassQuery({ ...options, output: 'count' });
}

/**
 * Build the `out count;` query for the sub-feature half of a union on its
 * own: the second selector of the union, in the same area and with the same
 * settings, and nothing else. The main count leaves the sub-features out on
 * purpose (see buildOverpassQuery), but they can be far more numerous than
 * the features they sit in - every parking space in a city - so they are
 * sized separately.
 * @param {Object} options - Options for buildOverpassQuery; `subFilters` is
 *     what is counted, and the main feature's selection is ignored
 * @returns {string} Overpass QL query, or '' when there is no sub-feature
 */
export function buildSubCountQuery(options = {}) {
    const { subFilters = null } = options;

    if (!Array.isArray(subFilters) || subFilters.length === 0) {
        return '';
    }
    return buildOverpassQuery({
        ...options,
        filters: subFilters,
        rawTagExpression: null,
        elementTypes: SUB_FEATURE_ELEMENT_TYPES,
        subFilters: null,
        output: 'count'
    });
}
