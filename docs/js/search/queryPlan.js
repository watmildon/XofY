/**
 * queryPlan.js
 * Turns a committed "X of Y" selection into everything the app needs to run it:
 * the query, its counting form, whether the size should be checked first, and
 * the grouping hint to apply.
 *
 * The same selection can be planned for either backend. Overpass is what the
 * app has always sent, byte for byte; Postpass additionally needs to be told
 * which of its two query shapes to use, and says through `estimateFilters`
 * which tag the client should size with taginfo to decide that.
 *
 * Pure logic: no DOM and no network, so the rules about which combinations are
 * guarded can be tested in Node.
 */

import {
    FEATURES,
    buildCuratedQuery,
    buildCuratedCountQuery,
    buildCuratedSql,
    buildCuratedSqlCount,
    curatedSqlUsesArea,
    getCuratedFilters,
    getAreaRef,
    isKnownArea,
    isSelfLimitingFeature
} from '../config/features.js';
import { buildGeomQuery, buildCountQuery } from './queryBuilder.js';
import { buildSqlGeomQuery, buildSqlCountQuery } from './sqlBuilder.js';

/**
 * Global uses below which a tag counts as rare, so that the tag-driven query
 * shape is the fast one. Measured either way round: California's 96,601
 * swimming pools time out tag-driven, and its 779 water slides time out
 * geometry-driven.
 */
export const RARE_TAG_THRESHOLD = 100000;

/**
 * Tag keys a Postpass query can never match.
 *
 * osm2pgsql reads `type` to decide which table a relation belongs in and does
 * not keep it, so `tags @> '{"type":"multipolygon"}'` matches nothing at all -
 * not an empty area, but a condition that is false for every row in the
 * database. A search that asks for one has to be sent to Overpass instead, and
 * the client can only say so if the plan tells it.
 */
const POSTPASS_UNSUPPORTED_KEYS = ['type'];

/**
 * The keys in a selection that Postpass cannot answer for
 * @param {Array<Object>} filters - Filters from tagParser
 * @returns {Array<string>} The offending keys, each once, in the order listed above
 */
export function unsupportedPostpassKeys(filters) {
    if (!Array.isArray(filters)) {
        return [];
    }
    return POSTPASS_UNSUPPORTED_KEYS.filter(
        key => filters.some(filter => filter && filter.key === key)
    );
}

/**
 * @typedef {Object} FeatureSelection
 * @property {'curated'|'free'} kind - Where the feature came from
 * @property {string} [key] - Curated feature key
 * @property {Array<Object>} [filters] - Tag filters, for a free-form feature
 * @property {string} [elementTypes] - Element selector, for a free-form feature
 */

/**
 * @typedef {Object} AreaSelection
 * @property {'curated'|'place'} kind - Where the area came from
 * @property {string} [key] - Curated area key
 * @property {{osmType: string, osmId: number}} [ref] - Searched place reference
 */

/**
 * @typedef {Object} QueryPlan
 * @property {'overpass'|'postpass'} backend - Which backend the query is for
 * @property {string} query - The query to run
 * @property {string} countQuery - Its counting form, or '' when there is none
 * @property {boolean} needsCount - Whether to size the result set first
 * @property {string|null} groupBy - Grouping hint, or null to leave the user's own
 * @property {Array<Object>} [estimateFilters] - Postpass only: the filters whose
 *     global tag count decides the query shape, or empty when the shape makes
 *     no difference to this selection
 * @property {number|null} [estimateCount] - Postpass only: a count the
 *     selection already knows, so nothing need be looked up at all
 * @property {Array<string>} [unsupportedKeys] - Postpass only: tag keys this
 *     query asks about that Postpass cannot match, so the client can say so
 *     rather than show an empty result
 */

/**
 * The area reference for an area selection
 * @param {AreaSelection} area - The selection
 * @returns {{osmType: string, osmId: number}|null} Reference, or null for the world
 * @throws {Error} When a curated key is unknown
 */
function areaRef(area) {
    return area.kind === 'curated' ? getAreaRef(area.key) : area.ref;
}

/**
 * The argument the curated builders take for an area selection
 * @param {AreaSelection} area - The selection
 * @returns {string|{osmType: string, osmId: number}} Curated key or reference
 */
function curatedTarget(area) {
    return area.kind === 'curated' ? area.key : area.ref;
}

/**
 * Which Postpass query shape to use for a tag that is used this often.
 * An unknown count (no preset count, taginfo unreachable) is treated as common,
 * because the geometry-driven shape is the one that degrades gracefully: it is
 * merely slower on a rare tag, while the tag-driven shape on a common tag in a
 * large area does not finish at all.
 * @param {number|null} count - Global uses of the tag, or null when unknown
 * @returns {'geometry'|'tag'} The shape to build
 */
export function shapeForTagCount(count) {
    if (count === null || count === undefined || !Number.isFinite(count) || count < 0) {
        return 'geometry';
    }
    return count < RARE_TAG_THRESHOLD ? 'tag' : 'geometry';
}

/**
 * Whether a selection could return more than the viewer should draw unchecked.
 * Curated features in curated areas are known quantities; anything free-form is
 * not. Features whose own query limits the result (the customQuery ones) are
 * exempt however they are searched.
 * @param {FeatureSelection} feature - The feature
 * @param {AreaSelection} area - The area
 * @returns {boolean} True when the size should be checked first
 */
export function needsCountFirst(feature, area) {
    if (feature.kind === 'curated' && isSelfLimitingFeature(feature.key)) {
        return false;
    }
    return feature.kind === 'free' || area.kind === 'place';
}

/**
 * Build the Overpass half of a plan
 * @param {FeatureSelection} feature - The feature half
 * @param {AreaSelection} area - The area half
 * @returns {QueryPlan|null} The plan, or null when the selection is not usable
 */
function overpassPlan(feature, area) {
    if (feature.kind === 'curated') {
        const target = curatedTarget(area);
        const query = buildCuratedQuery(feature.key, target);

        if (!query) {
            return null;
        }

        return {
            backend: 'overpass',
            query,
            countQuery: buildCuratedCountQuery(feature.key, target),
            needsCount: needsCountFirst(feature, area),
            groupBy: FEATURES[feature.key].groupBy || ''
        };
    }

    const options = {
        filters: feature.filters,
        elementTypes: feature.elementTypes,
        area: areaRef(area)
    };

    return {
        backend: 'overpass',
        query: buildGeomQuery(options),
        countQuery: buildCountQuery(options),
        needsCount: needsCountFirst(feature, area),
        // A free-form search has no grouping hint of its own, so whatever the
        // user set stays
        groupBy: null
    };
}

/**
 * Build the Postpass half of a plan
 * @param {FeatureSelection} feature - The feature half
 * @param {AreaSelection} area - The area half
 * @param {'geometry'|'tag'} shape - Which query shape to build
 * @returns {QueryPlan|null} The plan, or null when the selection is not usable
 */
function postpassPlan(feature, area, shape) {
    if (feature.kind === 'curated') {
        const target = curatedTarget(area);
        const query = buildCuratedSql(feature.key, target, { shape });

        if (!query) {
            return null;
        }

        const filters = getCuratedFilters(feature.key);

        return {
            backend: 'postpass',
            query,
            countQuery: buildCuratedSqlCount(feature.key, target, { shape }),
            needsCount: needsCountFirst(feature, area),
            groupBy: FEATURES[feature.key].groupBy || '',
            estimateFilters: curatedSqlUsesArea(feature.key, target) ? filters : [],
            // A curated feature may carry its own count, for taggings that
            // neither the preset file nor taginfo can be relied on to size
            estimateCount: Number.isFinite(FEATURES[feature.key].tagCount)
                ? FEATURES[feature.key].tagCount
                : null,
            unsupportedKeys: unsupportedPostpassKeys(filters)
        };
    }

    const options = {
        filters: feature.filters,
        elementTypes: feature.elementTypes,
        area: areaRef(area),
        shape
    };

    return {
        backend: 'postpass',
        query: buildSqlGeomQuery(options),
        countQuery: buildSqlCountQuery(options),
        needsCount: needsCountFirst(feature, area),
        groupBy: null,
        // With no boundary to intersect, both shapes are the same statement
        estimateFilters: options.area ? feature.filters : [],
        // Nothing typed carries a count of its own
        estimateCount: null,
        unsupportedKeys: unsupportedPostpassKeys(feature.filters)
    };
}

/**
 * Build everything needed to run a committed selection
 * @param {FeatureSelection|null} feature - The feature half
 * @param {AreaSelection|null} area - The area half
 * @param {Object} [options] - Planning options
 * @param {'overpass'|'postpass'} [options.backend] - Which backend to plan for
 * @param {'geometry'|'tag'} [options.shape] - Postpass query shape; the caller
 *     picks it from the plan's estimateFilters and builds again
 * @returns {QueryPlan|null} The plan, or null when either half is missing or
 *     the selection does not describe a query
 * @throws {Error} When an area reference cannot be used (a node, a bad id)
 */
export function buildQueryPlan(feature, area, options = {}) {
    const { backend = 'overpass', shape = 'geometry' } = options;

    if (!feature || !area) {
        return null;
    }

    if (feature.kind === 'curated') {
        if (!FEATURES[feature.key]) {
            return null;
        }
        if (area.kind === 'curated' && !isKnownArea(area.key)) {
            return null;
        }
    } else if (!Array.isArray(feature.filters) || feature.filters.length === 0) {
        return null;
    }

    return backend === 'postpass'
        ? postpassPlan(feature, area, shape)
        : overpassPlan(feature, area);
}
