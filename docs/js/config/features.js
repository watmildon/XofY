/**
 * features.js
 * Curated data: the features (X) the app knows about, the areas (Y) they can be
 * searched in, and the query building rules that tie the two together.
 *
 * See docs/AddMoreXAndY.md for how to add entries.
 */

import { buildOverpassQuery, normaliseOsmType, normaliseOsmId } from '../search/queryBuilder.js';

// Features (X) - what we're looking for
export const FEATURES = {
    'churches': {
        displayName: 'Churches',
        tags: '["building"="church"]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'parks': {
        displayName: 'Named Parks',
        tags: '["leisure"="park"][name]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'museums': {
        displayName: 'Museums',
        tags: '["tourism"="museum"]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'swimming_pools': {
        displayName: 'Swimming Pools',
        tags: '["leisure"="swimming_pool"]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'primary_highways': {
        displayName: 'Primary Roadways with Names',
        tags: '["highway"="primary"][name]',
        elementTypes: 'way',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: 'name'
    },
    'water_slides': {
        displayName: 'Water Slides',
        tags: '["attraction"="water_slide"]',
        elementTypes: 'way',
        minAdminLevel: 4,
        allowedAreas: null,
        groupBy: null
    },
    'motor_raceways': {
        displayName: 'Motor Raceways',
        tags: '["highway"="raceway"]["sport"="motor"]',
        elementTypes: 'way',
        minAdminLevel: 2,
        allowedAreas: null,
        groupBy: null
    },
    'cooling_basins': {
        displayName: 'Cooling Basins',
        tags: '["basin"="cooling"]',
        elementTypes: 'wr',
        minAdminLevel: 0,
        allowedAreas: null,
        groupBy: null
    },
    'jetsprint_lakes': {
        displayName: 'Jetsprint Lakes',
        tags: '["sport"="jetsprint"]["natural"="water"]',
        elementTypes: 'wr',
        minAdminLevel: 0,
        allowedAreas: ['world'],
        groupBy: null
    },
    'shot_put_pitches': {
        displayName: 'Shot Put Pitches',
        tags: '[athletics=shot_put]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: null,
        groupBy: null
    },
    'race_tracks': {
        displayName: 'Non-motor Race Tracks',
        tags: '[leisure=track][!athletics]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'subway_routes': {
        displayName: 'Subway Routes',
        tags: '[route=subway]',
        elementTypes: 'rel',
        minAdminLevel: 8,
        allowedAreas: ['nyc', 'paris', 'tokyo', 'seoul', 'singapore'],
        groupBy: null
    },
    'historic_aircraft': {
        displayName: 'Historic Aircraft',
        tags: '["historic"="aircraft"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['usa', 'germany', 'uk', 'france', 'italy', 'poland', 'australia', 'japan', 'brazil', 'south_africa', 'new_zealand', 'arizona', 'california', 'washington_state'],
        groupBy: null
    },
    'roller_coasters': {
        displayName: 'Roller Coasters',
        tags: '["roller_coaster"="track"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['disney_world'],
        groupBy: null
    },
    'cathedrals': {
        displayName: 'Cathedrals',
        tags: '["building"="cathedral"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['usa', 'germany', 'uk', 'france', 'italy', 'poland', 'australia', 'japan', 'brazil', 'south_africa', 'new_zealand'],
        groupBy: null
    },
    'lazy_rivers': {
        displayName: 'Lazy Rivers',
        tags: '["leisure"="swimming_pool"]["swimming_pool"="lazy_river"]',
        elementTypes: 'wr',
        minAdminLevel: 4,
        allowedAreas: ['arizona', 'california', 'washington_state', 'disney_world'],
        groupBy: null
    },
    'large_flowerbeds': {
        displayName: 'Large Flowerbeds (>50 nodes)',
        tags: '["landuse"="flowerbed"]',
        elementTypes: 'way',
        minAdminLevel: 2,
        allowedAreas: null,
        groupBy: null,
        customQuery: true
    },
    'playground_maps': {
        displayName: 'Playground Maps',
        tags: '["playground"="map"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['usa', 'arizona', 'california', 'washington_state'],
        groupBy: null
    }
};

// Areas (Y) - where we're looking
export const AREAS = {
    // World (special case - no area filter)
    'world': { displayName: 'The World', relationId: null, adminLevel: 0 },

    // Countries (admin_level 2)
    'usa': { displayName: 'United States', relationId: 148838, adminLevel: 2 },
    'germany': { displayName: 'Germany', relationId: 51477, adminLevel: 2 },
    'uk': { displayName: 'United Kingdom', relationId: 62149, adminLevel: 2 },
    'france': { displayName: 'France', relationId: 2202162, adminLevel: 2 },
    'italy': { displayName: 'Italy', relationId: 365331, adminLevel: 2 },
    'poland': { displayName: 'Poland', relationId: 49715, adminLevel: 2 },
    'australia': { displayName: 'Australia', relationId: 80500, adminLevel: 2 },
    'japan': { displayName: 'Japan', relationId: 382313, adminLevel: 2 },
    'brazil': { displayName: 'Brazil', relationId: 59470, adminLevel: 2 },
    'south_africa': { displayName: 'South Africa', relationId: 87565, adminLevel: 2 },
    'new_zealand': { displayName: 'New Zealand', relationId: 556706, adminLevel: 2 },

    // States/Provinces (admin_level 4)
    'arizona': { displayName: 'Arizona, US', relationId: 162018, adminLevel: 4 },
    'california': { displayName: 'California, US', relationId: 165475, adminLevel: 4 },
    'washington_state': { displayName: 'Washington, US', relationId: 165479, adminLevel: 4 },

    // Cities (admin_level 8)
    'seattle': { displayName: 'Seattle, WA', relationId: 237385, adminLevel: 8 },
    'phoenix': { displayName: 'Phoenix, AZ', relationId: 111257, adminLevel: 8 },
    'paris': { displayName: 'Paris, France', relationId: 7444, adminLevel: 8 },
    'sydney': { displayName: 'Sydney, AU', relationId: 5750005, adminLevel: 8 },
    'nyc': { displayName: 'New York City, NY', relationId: 175905, adminLevel: 8 },
    'tokyo': { displayName: 'Tokyo, Japan', relationId: 1543125, adminLevel: 8 },
    'seoul': { displayName: 'Seoul, South Korea', relationId: 2297418, adminLevel: 8 },
    'singapore': { displayName: 'Singapore', relationId: 536780, adminLevel: 8 },
    'bangkok': { displayName: 'Bangkok, Thailand', relationId: 92277, adminLevel: 8 },
    'cape_town': { displayName: 'Cape Town, South Africa', relationId: 79604, adminLevel: 8 },
    'nairobi': { displayName: 'Nairobi, Kenya', relationId: 3492709, adminLevel: 8 },
    'lagos': { displayName: 'Lagos, Nigeria', relationId: 3718182, adminLevel: 8 },
    'sao_paulo': { displayName: 'São Paulo, Brazil', relationId: 298285, adminLevel: 8 },
    'buenos_aires': { displayName: 'Buenos Aires, Argentina', relationId: 3082668, adminLevel: 8 },

    // Special areas (theme parks, etc.)
    'disney_world': { displayName: 'Disney World, FL', relationId: 1228099, adminLevel: 10 }
};

/**
 * Check whether an area key is one this app knows
 * @param {string} areaKey - Key from AREAS object
 * @returns {boolean} True when the key exists
 */
export function isKnownArea(areaKey) {
    return Object.prototype.hasOwnProperty.call(AREAS, areaKey);
}

/**
 * Get the Overpass area reference for a curated area.
 * Note the difference between the two "no id" cases: 'world' really does mean
 * the whole planet, while an unknown key (a stale `?area=` link, say) is an
 * error, because silently treating it as the world would run a planet-wide
 * query nobody asked for.
 * @param {string} areaKey - Key from AREAS object
 * @returns {{osmType: string, osmId: number}|null} Area reference, or null for the world
 * @throws {Error} When the key is not in AREAS (guard with isKnownArea first)
 */
export function getAreaRef(areaKey) {
    if (!isKnownArea(areaKey)) {
        throw new Error(`Unknown area: ${areaKey}`);
    }

    const area = AREAS[areaKey];

    if (!area.relationId) {
        return null;
    }
    return { osmType: 'relation', osmId: area.relationId };
}

/**
 * Check whether a curated feature limits its own result size. Custom queries
 * such as the flowerbed `foreach` filter do, so the count-first guardrail can
 * be skipped for them rather than special-casing feature keys elsewhere.
 * @param {string} featureKey - Key from FEATURES object
 * @returns {boolean} True when the feature's query limits itself
 */
export function isSelfLimitingFeature(featureKey) {
    return Boolean(FEATURES[featureKey] && FEATURES[featureKey].customQuery);
}

/**
 * Resolve the area argument accepted by buildCuratedQuery
 * @param {string|{osmType: string, osmId: number}} area - Curated area key or an area reference
 * @returns {{ref: {osmType: string, osmId: number}|null}|null} The resolved
 *     reference (null ref meaning the world), or null when the area is unusable
 */
function resolveArea(area) {
    if (area && typeof area === 'object') {
        return area.osmId ? { ref: area } : null;
    }
    if (!isKnownArea(area)) {
        return null;
    }
    return { ref: getAreaRef(area) };
}

/**
 * Subway networks are named rather than bounded, so these areas get a query of
 * their own instead of the standard area filter. They are looked up in one
 * place so that the count form below can tell it must not be used for them.
 */
const SUBWAY_QUERIES = {
    nyc: `[out:json];
rel[route=subway][network="NYC Subway"];
out geom;`,
    paris: `[out:json];
rel[route=subway][network="Métro de Paris"];
out geom;`,
    tokyo: `[out:json];
(
  rel[route=subway][network="Tokyo Metro"];
  rel[route=subway][network="都営地下鉄"];
);
out geom;`,
    seoul: `[out:json];
rel[route=subway][network="수도권 전철"];
out geom;`,
    singapore: `[out:json];
rel[route=subway][operator="SMRT Trains"];
out geom;`
};

/**
 * Whether a selection produces the standard `area + tags` query. Only that
 * shape has a count form that matches what will actually run.
 * @param {string} featureKey - Key from FEATURES object
 * @param {string|null} areaKey - Curated area key, or null for a searched place
 * @returns {boolean} True when the standard query is used
 */
function usesStandardQuery(featureKey, areaKey) {
    const feature = FEATURES[featureKey];

    if (!feature || feature.customQuery) {
        return false;
    }
    return !(featureKey === 'subway_routes' && SUBWAY_QUERIES[areaKey]);
}

/**
 * Render the `rel(id); map_to_area->.searchArea;` prelude for an area.
 * Validation is the query builder's, so both query paths reject the same
 * things - a node, say, which has no area for map_to_area to build.
 * @param {{osmType: string, osmId: number}} ref - Area reference
 * @returns {string} The prelude lines, newline terminated
 */
function areaPrelude(ref) {
    return `${normaliseOsmType(ref.osmType)}(${normaliseOsmId(ref.osmId)});
map_to_area->.searchArea;
`;
}

/**
 * Build an Overpass query from a feature and area selection
 * @param {string} featureKey - Key from FEATURES object
 * @param {string|{osmType: string, osmId: number}} area - Curated area key, or a
 *     free-form area reference from a place search
 * @returns {string} Overpass QL query, or '' when the selection is not usable
 */
export function buildCuratedQuery(featureKey, area) {
    const feature = FEATURES[featureKey];
    const resolved = resolveArea(area);

    if (!feature || !resolved) {
        return '';
    }

    const areaKey = typeof area === 'string' ? area : null;
    const ref = resolved.ref;

    // Handle special custom queries (like flowerbeds with foreach)
    if (feature.customQuery && featureKey === 'large_flowerbeds') {
        if (!ref) {
            // World query for flowerbeds
            return `[out:json];
way${feature.tags};
foreach (
  way._(if:count_members() > 50);
  out geom;
);`;
        }
        return `[out:json];
${areaPrelude(ref)}way(area.searchArea)${feature.tags};
foreach (
  way._(if:count_members() > 50);
  out geom;
);`;
    }

    // Handle subway routes with network filter
    if (featureKey === 'subway_routes' && SUBWAY_QUERIES[areaKey]) {
        return SUBWAY_QUERIES[areaKey];
    }

    // Standard query - the curated tag strings are already Overpass QL, so they
    // are passed through as-is. No timeout setting, to keep these queries byte
    // for byte what the app has always sent.
    return buildOverpassQuery({
        rawTagExpression: feature.tags,
        elementTypes: feature.elementTypes,
        area: ref,
        timeout: null
    });
}

/**
 * Build the `out count;` form of a curated query, for the guardrail that sizes
 * a result set before fetching it. The result differs from buildCuratedQuery
 * only in the out statement, so the count really is of what will run; the
 * selections that have a query of their own (custom queries, named subway
 * networks) have no such form and return ''.
 * @param {string} featureKey - Key from FEATURES object
 * @param {string|{osmType: string, osmId: number}} area - Curated area key or an area reference
 * @returns {string} Overpass QL query, or '' when there is nothing to count
 */
export function buildCuratedCountQuery(featureKey, area) {
    const resolved = resolveArea(area);
    const areaKey = typeof area === 'string' ? area : null;

    if (!resolved || !usesStandardQuery(featureKey, areaKey)) {
        return '';
    }

    return buildOverpassQuery({
        rawTagExpression: FEATURES[featureKey].tags,
        elementTypes: FEATURES[featureKey].elementTypes,
        area: resolved.ref,
        timeout: null,
        output: 'count'
    });
}

/**
 * Get valid areas for a given feature based on minAdminLevel and allowedAreas
 * @param {string} featureKey - Key from FEATURES object
 * @returns {Array} Array of [key, area] entries that are valid for this feature
 */
export function getValidAreasForFeature(featureKey) {
    const feature = FEATURES[featureKey];
    if (!feature) return [];

    // If feature has explicit allowedAreas, use only those
    if (feature.allowedAreas) {
        return feature.allowedAreas
            .filter(key => AREAS[key])
            .map(key => [key, AREAS[key]]);
    }

    // Otherwise filter by minAdminLevel
    return Object.entries(AREAS)
        .filter(([_, area]) => area.adminLevel >= feature.minAdminLevel);
}
