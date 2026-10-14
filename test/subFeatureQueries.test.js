/**
 * subFeatureQueries.test.js
 * Tests for what a sub-feature does to the queries, the plan, the curated
 * config and the share link.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOverpassQuery } from '../docs/js/search/queryBuilder.js';
import { buildSqlGeomQuery, buildSqlCountQuery } from '../docs/js/search/sqlBuilder.js';
import { buildQueryPlan } from '../docs/js/search/queryPlan.js';
import { FEATURES, getCuratedSubFilters, buildCuratedQuery } from '../docs/js/config/features.js';
import { encodeStateToParams, decodeParamsToState } from '../docs/js/utils/sharing.js';
import { parseTagExpression } from '../docs/js/search/tagParser.js';

const LOTS = [{ key: 'amenity', op: '=', value: 'parking' }];
const SPACES = [{ key: 'amenity', op: '=', value: 'parking_space' }];
const SEATTLE = { osmType: 'relation', osmId: 237385 };

test('Overpass: the sub-feature joins the main selector in a union', () => {
    assert.equal(
        buildOverpassQuery({ filters: LOTS, area: SEATTLE, timeout: null, subFilters: SPACES }),
        `[out:json];
rel(237385);
map_to_area->.searchArea;
(
  wr(area.searchArea)["amenity"="parking"];
  wr(area.searchArea)["amenity"="parking_space"];
);
out geom;`
    );

    assert.equal(
        buildOverpassQuery({ filters: LOTS, area: null, timeout: null, subFilters: SPACES }),
        `[out:json];
(
  wr["amenity"="parking"];
  wr["amenity"="parking_space"];
);
out geom;`
    );
});

test('Overpass: a count never includes the sub-feature, and an empty one changes nothing', () => {
    const plain = buildOverpassQuery({ filters: LOTS, area: SEATTLE, timeout: null });

    assert.equal(
        buildOverpassQuery({ filters: LOTS, area: SEATTLE, timeout: null, output: 'count', subFilters: SPACES }),
        plain.replace('out geom;', 'out count;')
    );
    assert.equal(buildOverpassQuery({ filters: LOTS, area: SEATTLE, timeout: null, subFilters: [] }), plain);
    assert.equal(buildOverpassQuery({ filters: LOTS, area: SEATTLE, timeout: null, subFilters: null }), plain);
});

test('Postpass: the sub-feature is a second SELECT over the same area, in both shapes', () => {
    const geometry = buildSqlGeomQuery({ filters: LOTS, area: SEATTLE, subFilters: SPACES });
    assert.equal(geometry, `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=237385) a
WHERE p.tags @> '{"amenity":"parking"}'::jsonb
  AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)
UNION ALL
SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=237385) a
WHERE p.tags @> '{"amenity":"parking_space"}'::jsonb
  AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)`);

    const tag = buildSqlGeomQuery({ filters: LOTS, area: SEATTLE, shape: 'tag', subFilters: SPACES });
    assert.match(tag, /^WITH a AS MATERIALIZED/);
    assert.equal((tag.match(/UNION ALL/g) || []).length, 1);
    assert.equal((tag.match(/EXISTS \(SELECT 1 FROM a/g) || []).length, 2, 'both halves test the boundary');
    assert.equal((tag.match(/WITH a AS/g) || []).length, 1, 'the boundary is subdivided once');
});

test('Postpass: a count never includes the sub-feature', () => {
    assert.equal(
        buildSqlCountQuery({ filters: LOTS, area: SEATTLE, subFilters: SPACES }),
        buildSqlCountQuery({ filters: LOTS, area: SEATTLE })
    );
});

test('a curated feature may declare a sub-feature default, and it must parse', () => {
    for (const [key, feature] of Object.entries(FEATURES)) {
        if (feature.subFeature) {
            const filters = getCuratedSubFilters(key);
            assert.ok(filters.length > 0, `${key} declares a readable sub-feature`);
        } else {
            assert.equal(getCuratedSubFilters(key), null);
        }
    }

    assert.deepEqual(getCuratedSubFilters('parking_lots'), SPACES);
    assert.equal(getCuratedSubFilters('no_such_feature'), null);
});

test('the curated parking query keeps its text without a sub-feature, and gains a union with one', () => {
    assert.equal(
        buildCuratedQuery('parking_lots', 'seattle'),
        `[out:json];
rel(237385);
map_to_area->.searchArea;
wr(area.searchArea)["amenity"="parking"][name];
out geom;`
    );
    assert.equal(
        buildCuratedQuery('parking_lots', 'seattle', { subFilters: SPACES }),
        `[out:json];
rel(237385);
map_to_area->.searchArea;
(
  wr(area.searchArea)["amenity"="parking"][name];
  wr(area.searchArea)["amenity"="parking_space"];
);
out geom;`
    );
    // The hand-written queries have no place for one
    assert.equal(
        buildCuratedQuery('subway_routes', 'nyc', { subFilters: SPACES }),
        buildCuratedQuery('subway_routes', 'nyc')
    );
});

test('the plan fetches what the field says and reports the curated default separately', () => {
    const parking = { kind: 'curated', key: 'parking_lots' };
    const seattle = { kind: 'curated', key: 'seattle' };

    // The default is reported, but nothing is fetched until the field says so
    const bare = buildQueryPlan(parking, seattle);
    assert.equal(bare.subFeature, 'amenity=parking_space');
    assert.equal(bare.subFilters, null);
    assert.doesNotMatch(bare.query, /parking_space/);
    assert.deepEqual(bare.filters, parseTagExpression('amenity=parking name=*').filters);

    const withSpaces = buildQueryPlan(parking, seattle, { subFilters: SPACES });
    assert.match(withSpaces.query, /wr\(area\.searchArea\)\["amenity"="parking_space"\];/);
    assert.deepEqual(withSpaces.subFilters, SPACES);
    assert.equal(withSpaces.countQuery, bare.countQuery, 'the count is of the lots alone');

    // The field can hold something other than the default
    const aisles = parseTagExpression('highway=service service=parking_aisle').filters;
    const withAisles = buildQueryPlan(parking, seattle, { subFilters: aisles });
    assert.match(withAisles.query, /\["service"="parking_aisle"\]/);
    assert.doesNotMatch(withAisles.query, /parking_space/);
    assert.equal(withAisles.subFeature, 'amenity=parking_space', 'the default is still reported');

    // A feature without a default reports none
    const parks = buildQueryPlan({ kind: 'curated', key: 'parks' }, seattle, { subFilters: SPACES });
    assert.equal(parks.subFeature, null);
    assert.match(parks.query, /parking_space/);
});

test('the Postpass plan sizes the sub-feature tag too, and refuses an unsupported key in it', () => {
    const free = { kind: 'free', filters: LOTS, elementTypes: 'wr' };
    const seattle = { kind: 'curated', key: 'seattle' };

    const plan = buildQueryPlan(free, seattle, { backend: 'postpass', subFilters: SPACES });
    assert.match(plan.query, /UNION ALL/);
    assert.deepEqual(plan.estimateFilters, LOTS);
    assert.deepEqual(plan.subEstimateFilters, SPACES);
    assert.deepEqual(plan.subFilters, SPACES);
    assert.deepEqual(plan.unsupportedKeys, []);

    const typed = buildQueryPlan(free, seattle, {
        backend: 'postpass',
        subFilters: [{ key: 'type', op: '=', value: 'multipolygon' }]
    });
    assert.deepEqual(typed.unsupportedKeys, ['type']);

    // A named subway network has no area for a sub-feature to be inside
    const subway = buildQueryPlan({ kind: 'curated', key: 'subway_routes' }, { kind: 'curated', key: 'nyc' }, {
        backend: 'postpass',
        subFilters: SPACES
    });
    assert.equal(subway.subFilters, null);
    assert.deepEqual(subway.subEstimateFilters, []);
    assert.doesNotMatch(subway.query, /UNION ALL/);
});

test('the share link carries the sub-feature and its colour', () => {
    const params = encodeStateToParams({
        tab: 'curated',
        feature: 'parking_lots',
        area: 'seattle',
        subFeatureTag: ' amenity=parking_space ',
        subFeatureColor: '#112233'
    });
    assert.equal(params.get('sub'), 'amenity=parking_space');
    assert.equal(params.get('scolor'), '112233');

    // The default colour needs no saying, and no sub-feature means no colour
    assert.equal(encodeStateToParams({ subFeatureTag: 'x=y', subFeatureColor: '#ff7f0e' }).has('scolor'), false);
    const none = encodeStateToParams({ subFeatureTag: '', subFeatureColor: '#112233' });
    assert.equal(none.has('sub'), false);
    assert.equal(none.has('scolor'), false);

    const decoded = decodeParamsToState('?feature=parking_lots&area=seattle&sub=amenity%3Dparking_space&scolor=112233');
    assert.equal(decoded.subFeatureTag, 'amenity=parking_space');
    assert.equal(decoded.subFeatureColor, '#112233');
    assert.equal(decodeParamsToState('?feature=parks').subFeatureTag, undefined);
});
