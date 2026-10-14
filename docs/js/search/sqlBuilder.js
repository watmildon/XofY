/**
 * sqlBuilder.js
 * Builds Postpass SQL from the same parsed feature (X) and area (Y) selection
 * that queryBuilder.js turns into Overpass QL.
 *
 * Postpass runs one SELECT against a PostGIS database of the OSM planet, so the
 * generated shape matters much more than it does on Overpass: the planner will
 * not choose between the two shapes below by itself, and the wrong one for a
 * given tag runs for minutes instead of seconds. Both were timed against the
 * live server; do not "simplify" them without timing them again.
 *
 * Geometry-driven (shape: 'geometry'), for tags that are common enough that the
 * boundary is the cheaper side to start from:
 *
 *     SELECT p.osm_type, p.osm_id, p.tags, p.geom
 *     FROM postpass_linepolygon p,
 *          (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=170100) a
 *     WHERE p.tags @> '{"leisure":"swimming_pool"}'::jsonb
 *       AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)
 *
 * Tag-driven (shape: 'tag'), for rare tags, where the GIN index on tags finds
 * every candidate on the planet quickly and the subdivided boundary then tests
 * them one by one:
 *
 *     WITH a AS MATERIALIZED (
 *       SELECT ST_Subdivide(geom, 64) AS geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=165475)
 *     SELECT p.osm_type, p.osm_id, p.tags, p.geom
 *     FROM postpass_linepolygon p
 *     WHERE p.tags @> '{"attraction":"water_slide"}'::jsonb
 *       AND EXISTS (SELECT 1 FROM a WHERE p.geom && a.geom AND ST_Intersects(p.geom, a.geom))
 *
 * The statement never ends in a semicolon: Postpass wraps what it is given in a
 * subquery and refuses anything but a single SELECT.
 *
 * Pure logic: no DOM and no network, so it can be imported in Node for tests.
 */

import {
    DEFAULT_ELEMENT_TYPES,
    normaliseOsmType,
    normaliseOsmId
} from './queryBuilder.js';

/** The union view of lines and polygons, which is what a search wants */
export const DEFAULT_TABLE = 'postpass_linepolygon';

/**
 * Tables this module is willing to read. postpass_point is deliberately absent:
 * this app draws shapes, and a node has none - except as a sub-feature, where
 * a node is a dot inside something that does have a shape (see POINT_TABLE).
 */
const ALLOWED_TABLES = ['postpass_linepolygon', 'postpass_line', 'postpass_polygon'];

/** Where the nodes are; read only for the sub-feature half of a query */
const POINT_TABLE = 'postpass_point';

/**
 * How many vertices ST_Subdivide is allowed to leave in each piece of a
 * boundary. 64 was the fastest of the sizes tried (France subdivides into 3,814
 * pieces in 1.3 s).
 */
export const SUBDIVIDE_VERTICES = 64;

/**
 * Element selectors, and the osm_type condition each one adds. 'wr' needs none:
 * the tables only hold ways and relations anyway.
 */
const ELEMENT_TYPE_CONDITIONS = {
    wr: null,
    way: "p.osm_type='W'",
    rel: "p.osm_type='R'"
};

/**
 * Check whether a value is an element type selector this module can express
 * @param {string} elementTypes - Candidate selector
 * @returns {boolean} True when it is one of wr/way/rel
 */
export function isSupportedSqlElementTypes(elementTypes) {
    return Object.prototype.hasOwnProperty.call(ELEMENT_TYPE_CONDITIONS, elementTypes);
}

/**
 * Render a value as a complete SQL string literal, quotes included.
 *
 * Doubling `'` is all that is needed while standard_conforming_strings is on,
 * which it is on Postpass. Text holding a backslash is written as an E'' string
 * with the backslashes doubled as well, so that the literal is still exactly
 * the input even if that setting is ever off - a typed `\'` must never be able
 * to end the literal early.
 * @param {string} value - Raw text
 * @returns {string} A SQL literal such as 'plain' or E'back\\slash'
 */
export function escapeSqlString(value) {
    const text = String(value ?? '');

    if (text.includes('\\')) {
        return `E'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    }
    return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Render one tag filter as a SQL condition on the `p` row.
 *
 * `@>` and `?` are the operators the GIN index on tags can answer; `->>` cannot
 * use it, which is why regex filters are only ever an extra condition beside
 * one that can.
 * @param {Object} filter - Filter from tagParser ({key, op, value})
 * @returns {string} A boolean SQL expression
 * @throws {Error} When the filter has no key or an operator with no SQL form
 */
export function formatSqlFilter(filter) {
    if (!filter || !filter.key) {
        throw new Error('Tag filter is missing a key');
    }

    const key = String(filter.key);
    const literalKey = escapeSqlString(key);
    // JSON.stringify escapes whatever the key or value holds; escapeSqlString
    // then makes the whole JSON text one SQL literal
    const asJson = () => escapeSqlString(JSON.stringify({ [key]: String(filter.value ?? '') }));

    switch (filter.op) {
        case '=':
            return `p.tags @> ${asJson()}::jsonb`;
        case '!=':
            // Overpass [k!=v] also matches elements without k at all, and so
            // does this: a row with no k does not contain {k: v}
            return `NOT (p.tags @> ${asJson()}::jsonb)`;
        case 'exists':
            return `p.tags ? ${literalKey}`;
        case 'missing':
            return `NOT (p.tags ? ${literalKey})`;
        case '~':
            return `p.tags->>${literalKey} ~ ${escapeSqlString(filter.value)}`;
        case '!~':
            // ->> is NULL when the key is absent, and NULL !~ ... is NULL
            // rather than true, so say what Overpass means: no k, no match
            return `COALESCE(p.tags->>${literalKey} !~ ${escapeSqlString(filter.value)}, true)`;
        default:
            throw new Error(`Unsupported tag filter operator: ${filter.op}`);
    }
}

/**
 * Render several filters as one condition matching any of them, for the
 * curated selections that mirror an Overpass union (Tokyo's two subway
 * networks, say)
 * @param {Array<Object>} filters - Filters from tagParser
 * @returns {string} A parenthesised OR of the conditions
 * @throws {Error} When there is nothing to OR together
 */
export function formatSqlAnyOf(filters) {
    if (!Array.isArray(filters) || filters.length === 0) {
        throw new Error('formatSqlAnyOf needs at least one filter');
    }
    return `(${filters.map(formatSqlFilter).join(' OR ')})`;
}

/**
 * Turn an area reference into the osm_type/osm_id pair that selects its
 * boundary polygon. Validation is queryBuilder's, so both backends reject the
 * same things - a node, say, which has no boundary polygon at all.
 * @param {{osmType: string, osmId: number}} area - Area reference
 * @returns {{type: string, id: number}} 'R' or 'W', and the id
 * @throws {Error} When the reference cannot be used
 */
function areaKey(area) {
    return {
        type: normaliseOsmType(area.osmType) === 'rel' ? 'R' : 'W',
        id: normaliseOsmId(area.osmId)
    };
}

/**
 * Build a Postpass SQL query
 * @param {Object} options - Query options
 * @param {Array<Object>} [options.filters] - Tag filters from tagParser
 * @param {string} [options.elementTypes] - Element selector ('wr', 'way', 'rel')
 * @param {{osmType: string, osmId: number}|null} [options.area] - Area to search, or null for the world
 * @param {'geometry'|'tag'} [options.shape] - Which of the two query shapes to use
 * @param {string} [options.table] - Table or view to read
 * @param {string|null} [options.extraWhere] - A ready-made SQL condition, ANDed
 *     with the rest. WARNING: this text is inserted verbatim, so it is only for
 *     the hand-written curated conditions in config/features.js. Anything
 *     derived from user input must go through `filters`, which escapes it.
 * @param {'geom'|'count'} [options.output] - Rows, or how many rows there are
 * @param {Array<Object>|null} [options.subFilters] - Tag filters for the
 *     sub-features to fetch alongside the main feature, as a second SELECT
 *     over the same table and area joined by UNION ALL, and a third over the
 *     point table, since a sub-feature may be a node. Both use the same query
 *     shape as the main one: the planner picks the shape for the set. A count
 *     never includes them (see queryBuilder.js for why).
 * @param {boolean} [options.pointsToo] - True also reads the point table for
 *     the main conditions, as a further UNION ALL branch. Only the sub-feature
 *     count uses it, to count the nodes the union fetches
 * @returns {string} A single SELECT statement, with no trailing semicolon
 * @throws {Error} When any part of the selection cannot be expressed safely
 */
export function buildPostpassQuery(options = {}) {
    const {
        filters = [],
        elementTypes = DEFAULT_ELEMENT_TYPES,
        area = null,
        shape = 'geometry',
        table = DEFAULT_TABLE,
        extraWhere = null,
        output = 'geom',
        subFilters = null,
        pointsToo = false
    } = options;

    if (!isSupportedSqlElementTypes(elementTypes)) {
        throw new Error(`Unsupported element types: ${elementTypes}`);
    }
    if (shape !== 'geometry' && shape !== 'tag') {
        throw new Error(`Unsupported query shape: ${shape}`);
    }
    if (!ALLOWED_TABLES.includes(table)) {
        throw new Error(`Unsupported table: ${table}`);
    }
    if (output !== 'geom' && output !== 'count') {
        throw new Error(`Unsupported output mode: ${output}`);
    }

    const conditions = (Array.isArray(filters) ? filters : []).map(formatSqlFilter);
    const typeCondition = ELEMENT_TYPE_CONDITIONS[elementTypes];

    if (typeCondition) {
        conditions.push(typeCondition);
    }
    if (extraWhere) {
        conditions.push(extraWhere);
    }

    // Sub-features: ways and relations alike, no extra condition, same area
    const subConditions = output === 'geom' && Array.isArray(subFilters) && subFilters.length > 0
        ? subFilters.map(formatSqlFilter)
        : null;

    const hasArea = Boolean(area && area.osmId !== null && area.osmId !== undefined);

    // Without a boundary and without a condition this would read every line and
    // polygon on the planet. Overpass would refuse such a query on its timeout;
    // Postpass has no practical timeout and would simply keep working long
    // after the client gave up on it
    if (conditions.length === 0 && !hasArea) {
        throw new Error('A Postpass query needs at least one tag filter or an area');
    }

    let prefix = '';
    // What follows FROM for a table: the table alone, or the table and the
    // boundary polygon beside it in the geometry-driven shape
    let fromFor = (name) => `FROM ${name} p`;

    if (hasArea) {
        const { type, id } = areaKey(area);

        let areaCondition;

        if (shape === 'tag') {
            prefix = `WITH a AS MATERIALIZED (
  SELECT ST_Subdivide(geom, ${SUBDIVIDE_VERTICES}) AS geom FROM postpass_polygon WHERE osm_type='${type}' AND osm_id=${id})
`;
            areaCondition = 'EXISTS (SELECT 1 FROM a WHERE p.geom && a.geom AND ST_Intersects(p.geom, a.geom))';
        } else {
            fromFor = (name) => `FROM ${name} p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='${type}' AND osm_id=${id}) a`;
            areaCondition = 'p.geom && a.geom AND ST_Intersects(p.geom, a.geom)';
        }

        conditions.push(areaCondition);
        if (subConditions) {
            subConditions.push(areaCondition);
        }
    }

    /**
     * The row query for one set of conditions over one table
     * @param {Array<string>} where - Conditions to AND together
     * @param {string} name - The table to read
     * @returns {string} A SELECT statement
     */
    const select = (where, name) => `SELECT p.osm_type, p.osm_id, p.tags, p.geom
${fromFor(name)}
WHERE ${where.join('\n  AND ')}`;

    const selects = [
        select(conditions, table),
        ...(pointsToo ? [select(conditions, POINT_TABLE)] : []),
        ...(subConditions ? [select(subConditions, table), select(subConditions, POINT_TABLE)] : [])
    ];
    const inner = selects.join('\nUNION ALL\n');

    if (output === 'count') {
        // The count wraps the row query unchanged, so it counts rows and not
        // objects: a boundary relation has a row in the line table and another
        // in the polygon table, which postpassResults then merges back into one
        // element. The count can therefore read a little high, and that is the
        // point - it is a guardrail about how much work the geometry query
        // would be, so it has to size exactly what that query would fetch.
        // Deduplicating here (DISTINCT, or counting osm_type/osm_id pairs)
        // would both understate the work and change the inner shape, whose
        // timings are the reason it looks like this
        return `${prefix}SELECT count(*) AS total FROM (
${inner}
) t`;
    }
    return prefix + inner;
}

/**
 * Build the row-returning variant of a query
 * @param {Object} options - Options for buildPostpassQuery
 * @returns {string} Postpass SQL
 */
export function buildSqlGeomQuery(options = {}) {
    return buildPostpassQuery({ ...options, output: 'geom' });
}

/**
 * Build the counting variant of a query, used to size a result set first
 * @param {Object} options - Options for buildPostpassQuery
 * @returns {string} Postpass SQL
 */
export function buildSqlCountQuery(options = {}) {
    return buildPostpassQuery({ ...options, output: 'count' });
}

/**
 * Build the counting query for the sub-feature half of a UNION ALL on its
 * own: the second SELECT, over the same table and area and in the same shape,
 * with no element type or extra condition, exactly as the union writes it.
 * See buildSubCountQuery in queryBuilder.js for why it is counted apart.
 * @param {Object} options - Options for buildPostpassQuery; `subFilters` is
 *     what is counted, and the main feature's conditions are ignored
 * @returns {string} Postpass SQL, or '' when there is no sub-feature
 */
export function buildSqlSubCountQuery(options = {}) {
    const { subFilters = null } = options;

    if (!Array.isArray(subFilters) || subFilters.length === 0) {
        return '';
    }
    return buildPostpassQuery({
        ...options,
        filters: subFilters,
        // Nodes, ways and relations, like the union: the shape tables only
        // hold ways and relations and need no condition for them, and the
        // point table branch below is where the nodes come from
        elementTypes: DEFAULT_ELEMENT_TYPES,
        extraWhere: null,
        subFilters: null,
        pointsToo: true,
        output: 'count'
    });
}
