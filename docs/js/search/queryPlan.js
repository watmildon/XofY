/**
 * queryPlan.js
 * Turns a committed "X of Y" selection into everything the app needs to run it:
 * the query, its `out count;` form, whether the size should be checked first,
 * and the grouping hint to apply.
 *
 * Pure logic: no DOM and no network, so the rules about which combinations are
 * guarded can be tested in Node.
 */

import {
    FEATURES,
    buildCuratedQuery,
    buildCuratedCountQuery,
    getAreaRef,
    isKnownArea,
    isSelfLimitingFeature
} from '../config/features.js';
import { buildGeomQuery, buildCountQuery } from './queryBuilder.js';

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
 * @property {string} query - The Overpass query to run
 * @property {string} countQuery - Its `out count;` form, or '' when there is none
 * @property {boolean} needsCount - Whether to size the result set first
 * @property {string|null} groupBy - Grouping hint, or null to leave the user's own
 */

/**
 * The Overpass area reference for an area selection
 * @param {AreaSelection} area - The selection
 * @returns {{osmType: string, osmId: number}|null} Reference, or null for the world
 * @throws {Error} When a curated key is unknown
 */
function areaRef(area) {
    return area.kind === 'curated' ? getAreaRef(area.key) : area.ref;
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
 * Build everything needed to run a committed selection
 * @param {FeatureSelection|null} feature - The feature half
 * @param {AreaSelection|null} area - The area half
 * @returns {QueryPlan|null} The plan, or null when either half is missing or
 *     the selection does not describe a query
 * @throws {Error} When an area reference cannot be used (a node, a bad id)
 */
export function buildQueryPlan(feature, area) {
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

        const target = area.kind === 'curated' ? area.key : area.ref;
        const query = buildCuratedQuery(feature.key, target);

        if (!query) {
            return null;
        }

        return {
            query,
            countQuery: buildCuratedCountQuery(feature.key, target),
            needsCount: needsCountFirst(feature, area),
            groupBy: FEATURES[feature.key].groupBy || ''
        };
    }

    if (!Array.isArray(feature.filters) || feature.filters.length === 0) {
        return null;
    }

    const options = {
        filters: feature.filters,
        elementTypes: feature.elementTypes,
        area: areaRef(area)
    };

    return {
        query: buildGeomQuery(options),
        countQuery: buildCountQuery(options),
        needsCount: needsCountFirst(feature, area),
        // A free-form search has no grouping hint of its own, so whatever the
        // user set stays
        groupBy: null
    };
}
