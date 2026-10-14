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
    buildCuratedSubCountQuery,
    buildCuratedSql,
    buildCuratedSqlCount,
    buildCuratedSqlSubCount,
    curatedSqlUsesArea,
    getCuratedFilters,
    getAreaRef,
    isKnownArea,
    isSelfLimitingFeature
} from '../config/features.js';
import { buildGeomQuery, buildCountQuery, buildSubCountQuery } from './queryBuilder.js';
import { buildSqlGeomQuery, buildSqlCountQuery, buildSqlSubCountQuery } from './sqlBuilder.js';

/**
 * Global uses below which a tag counts as rare, so that the tag-driven query
 * shape is the fast one. Measured either way round: California's 96,601
 * swimming pools time out tag-driven, and its 779 water slides time out
 * geometry-driven.
 */
export const RARE_TAG_THRESHOLD = 100000;

/**
 * How many features a search may match before the viewer warns instead of
 * drawing them. The grid appends 50 items at a time and never drops what it has
 * drawn, and every item is a 200px canvas scaled by devicePixelRatio (around
 * 640 KB of backing store each on a 2x screen), so a few thousand items is
 * already a gigabyte of canvas and dozens of scroll batches. The spec's own
 * example of an enormous result - 4,955 swimming pools in Nice - sits above it.
 */
export const MAX_UNWARNED_RESULTS = 2000;

/**
 * How many sub-features a search may fetch before the viewer warns. They get
 * no canvas of their own, so the limit is much higher than for features; what
 * they cost is the download, the parse, and testing each one against the
 * features it might sit in. Measured with named parking lots and their
 * parking spaces: Seattle (4.7k), Phoenix (5.8k) and Tokyo (10.8k) stay under
 * it, Sydney (30.9k) and New York (92k) do not.
 */
export const MAX_UNWARNED_SUB_FEATURES = 20000;

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
 * @property {string} subCountQuery - The counting form of the sub-feature
 *     half alone, or '' when the query fetches no sub-features. It is meant to
 *     be run whenever it is there, whatever needsCount says: needsCount vouches
 *     for the feature and the area, and nothing vouches for what was typed in
 *     the Sub-feature field
 * @property {string|null} groupBy - Grouping hint, or null to leave the user's own
 * @property {Array<Object>} filters - The main feature's tag filters, so that
 *     a result can be sorted into main features and sub-features afterwards
 * @property {Array<Object>|null} subFilters - The sub-feature filters the
 *     query fetches alongside, or null when it fetches none
 * @property {string|null} subFeature - The curated feature's default for the
 *     Sub-feature field, or null when it declares none
 * @property {Array<Object>} [estimateFilters] - Postpass only: the filters whose
 *     global tag count decides the query shape, or empty when the shape makes
 *     no difference to this selection
 * @property {number|null} [estimateCount] - Postpass only: a count the
 *     selection already knows, so nothing need be looked up at all
 * @property {Array<Object>} [subEstimateFilters] - Postpass only: the
 *     sub-feature filters whose global count also bears on the query shape,
 *     since both halves of the union are written in the same shape
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
 * @typedef {Object} SizeJudgement
 * @property {'run'|'empty'|'large'} verdict - Run it, say nothing matches, or
 *     warn first
 * @property {boolean} mainLarge - The features are over their limit
 * @property {boolean} subLarge - The sub-features are over theirs
 */

/**
 * Decide what to do with a search from its counts. Either count may be
 * missing - not run, or not readable - and a missing count never blocks a
 * search on its own.
 * @param {number|null} total - Features the search matches, or null
 * @param {number|null} subTotal - Sub-features it would fetch, or null
 * @returns {SizeJudgement} What to do
 */
export function judgeSearchSize(total, subTotal) {
    const known = value => typeof value === 'number' && Number.isFinite(value);
    const mainLarge = known(total) && total > MAX_UNWARNED_RESULTS;
    const subLarge = known(subTotal) && subTotal > MAX_UNWARNED_SUB_FEATURES;

    // With no features there is nothing to draw the sub-features in
    if (total === 0) {
        return { verdict: 'empty', mainLarge: false, subLarge: false };
    }
    return {
        verdict: mainLarge || subLarge ? 'large' : 'run',
        mainLarge,
        subLarge
    };
}

/**
 * A count and its noun, singular when there is one
 * @param {number} count - How many
 * @param {string} noun - The singular noun
 * @returns {string} e.g. "1 feature", "2,000 features"
 */
function counted(count, noun) {
    return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The words for a size warning, saying which half of the search is large
 * @param {number|null} total - Features the search matches, or null
 * @param {number|null} subTotal - Sub-features it would fetch, or null
 * @param {SizeJudgement} judgement - From judgeSearchSize, with verdict 'large'
 * @returns {{heading: string, detail: string, suggestion: string}} Plain text
 */
export function describeSizeWarning(total, subTotal, judgement) {
    const heading = 'That is a lot of features';
    const slow = 'Drawing that many will make the page very slow.';

    if (judgement.mainLarge && judgement.subLarge) {
        return {
            heading,
            detail: `This search matches ${counted(total, 'feature')}, and would also fetch ${counted(subTotal, 'sub-feature')} to place inside them. ${slow}`,
            suggestion: 'Try a smaller area, or narrow the feature and the sub-feature down.'
        };
    }
    if (judgement.subLarge) {
        const inside = typeof total === 'number' && total > 0
            ? ` to place inside its ${counted(total, 'feature')}`
            : '';
        return {
            heading,
            detail: `It is the sub-features that are large: this search would fetch ${counted(subTotal, 'sub-feature')}${inside}. Fetching and placing that many will make the page very slow.`,
            suggestion: 'Try a smaller area, narrow the sub-feature down, or clear the Sub-feature field.'
        };
    }
    return {
        heading,
        detail: `This search matches ${total.toLocaleString()} features. ${slow}`,
        suggestion: 'Try a smaller area, or narrow the feature down.'
    };
}

/**
 * The sub-feature a selection fetches alongside the feature.
 *
 * What is fetched is always what the Sub-feature field says. A curated
 * feature may declare a default for that field (`subFeature`), which the
 * plan passes along so the field can be filled when the feature is chosen;
 * unlike the grouping hint it is a suggestion, and the field is the user's
 * to change or clear afterwards.
 * @param {FeatureSelection} feature - The feature half
 * @param {Array<Object>|null} typed - Filters from the Sub-feature field
 * @returns {{filters: Array<Object>|null, expression: string|null}} The
 *     filters to fetch, and the curated default, if there is one
 */
function subFeatureFor(feature, typed) {
    const declared = feature.kind === 'curated' ? FEATURES[feature.key].subFeature || null : null;

    return {
        filters: Array.isArray(typed) && typed.length > 0 ? typed : null,
        expression: declared
    };
}

/**
 * Build the Overpass half of a plan
 * @param {FeatureSelection} feature - The feature half
 * @param {AreaSelection} area - The area half
 * @param {Array<Object>|null} typedSub - Filters from the Sub-feature field
 * @returns {QueryPlan|null} The plan, or null when the selection is not usable
 */
function overpassPlan(feature, area, typedSub) {
    const sub = subFeatureFor(feature, typedSub);

    if (feature.kind === 'curated') {
        const target = curatedTarget(area);
        const query = buildCuratedQuery(feature.key, target, { subFilters: sub.filters });

        if (!query) {
            return null;
        }

        return {
            backend: 'overpass',
            query,
            countQuery: buildCuratedCountQuery(feature.key, target),
            needsCount: needsCountFirst(feature, area),
            subCountQuery: buildCuratedSubCountQuery(feature.key, target, sub.filters),
            groupBy: FEATURES[feature.key].groupBy || '',
            filters: getCuratedFilters(feature.key),
            subFilters: sub.filters,
            subFeature: sub.expression
        };
    }

    const options = {
        filters: feature.filters,
        elementTypes: feature.elementTypes,
        area: areaRef(area)
    };

    return {
        backend: 'overpass',
        query: buildGeomQuery({ ...options, subFilters: sub.filters }),
        countQuery: buildCountQuery(options),
        needsCount: needsCountFirst(feature, area),
        subCountQuery: buildSubCountQuery({ ...options, subFilters: sub.filters }),
        // A free-form search has no grouping hint of its own, so whatever the
        // user set stays
        groupBy: null,
        filters: feature.filters,
        subFilters: sub.filters,
        subFeature: null
    };
}

/**
 * Build the Postpass half of a plan
 * @param {FeatureSelection} feature - The feature half
 * @param {AreaSelection} area - The area half
 * @param {'geometry'|'tag'} shape - Which query shape to build
 * @param {Array<Object>|null} typedSub - Filters from the Sub-feature field
 * @returns {QueryPlan|null} The plan, or null when the selection is not usable
 */
function postpassPlan(feature, area, shape, typedSub) {
    const sub = subFeatureFor(feature, typedSub);

    if (feature.kind === 'curated') {
        const target = curatedTarget(area);
        const query = buildCuratedSql(feature.key, target, { shape, subFilters: sub.filters });

        if (!query) {
            return null;
        }

        const filters = getCuratedFilters(feature.key);
        const usesArea = curatedSqlUsesArea(feature.key, target);

        return {
            backend: 'postpass',
            query,
            countQuery: buildCuratedSqlCount(feature.key, target, { shape }),
            needsCount: needsCountFirst(feature, area),
            subCountQuery: buildCuratedSqlSubCount(feature.key, target, sub.filters, { shape }),
            groupBy: FEATURES[feature.key].groupBy || '',
            filters,
            subFilters: usesArea ? sub.filters : null,
            subFeature: sub.expression,
            estimateFilters: usesArea ? filters : [],
            // A curated feature may carry its own count, for taggings that
            // neither the preset file nor taginfo can be relied on to size
            estimateCount: Number.isFinite(FEATURES[feature.key].tagCount)
                ? FEATURES[feature.key].tagCount
                : null,
            subEstimateFilters: usesArea && sub.filters ? sub.filters : [],
            unsupportedKeys: unsupportedPostpassKeys([...filters, ...(sub.filters || [])])
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
        query: buildSqlGeomQuery({ ...options, subFilters: sub.filters }),
        countQuery: buildSqlCountQuery(options),
        needsCount: needsCountFirst(feature, area),
        subCountQuery: buildSqlSubCountQuery({ ...options, subFilters: sub.filters }),
        groupBy: null,
        filters: feature.filters,
        subFilters: sub.filters,
        subFeature: null,
        // With no boundary to intersect, both shapes are the same statement
        estimateFilters: options.area ? feature.filters : [],
        // Nothing typed carries a count of its own
        estimateCount: null,
        subEstimateFilters: options.area && sub.filters ? sub.filters : [],
        unsupportedKeys: unsupportedPostpassKeys([...feature.filters, ...(sub.filters || [])])
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
 * @param {Array<Object>|null} [options.subFilters] - Filters from the
 *     Sub-feature field, used unless the curated feature declares its own
 * @returns {QueryPlan|null} The plan, or null when either half is missing or
 *     the selection does not describe a query
 * @throws {Error} When an area reference cannot be used (a node, a bad id)
 */
export function buildQueryPlan(feature, area, options = {}) {
    const { backend = 'overpass', shape = 'geometry', subFilters = null } = options;

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
        ? postpassPlan(feature, area, shape, subFilters)
        : overpassPlan(feature, area, subFilters);
}
