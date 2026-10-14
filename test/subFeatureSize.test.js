/**
 * subFeatureSize.test.js
 * Tests for sizing the sub-feature half of a search: its counting queries,
 * the plan field that carries them, and the rules that decide when a search
 * warns before it runs.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOverpassQuery, buildSubCountQuery } from '../docs/js/search/queryBuilder.js';
import { buildSqlGeomQuery, buildSqlSubCountQuery } from '../docs/js/search/sqlBuilder.js';
import {
    buildQueryPlan,
    judgeSearchSize,
    describeSizeWarning,
    MAX_UNWARNED_RESULTS,
    MAX_UNWARNED_SUB_FEATURES
} from '../docs/js/search/queryPlan.js';
import {
    FEATURES,
    buildCuratedSubCountQuery,
    buildCuratedSqlSubCount,
    getValidAreasForFeature
} from '../docs/js/config/features.js';

const LOTS = [{ key: 'amenity', op: '=', value: 'parking' }];
const SPACES = [{ key: 'amenity', op: '=', value: 'parking_space' }];
const SEATTLE = { osmType: 'relation', osmId: 237385 };

const parking = { kind: 'curated', key: 'parking_lots' };
const seattle = { kind: 'curated', key: 'seattle' };

test('Overpass: the sub-feature count is the second selector of the union, counted', () => {
    assert.equal(
        buildSubCountQuery({ filters: LOTS, area: SEATTLE, timeout: null, subFilters: SPACES }),
        `[out:json];
rel(237385);
map_to_area->.searchArea;
nwr(area.searchArea)["amenity"="parking_space"];
out count;`
    );

    // The selector really is the one the union fetches
    const union = buildOverpassQuery({ filters: LOTS, area: SEATTLE, timeout: null, subFilters: SPACES });
    assert.ok(union.includes('  nwr(area.searchArea)["amenity"="parking_space"];\n'));

    // Whatever the main feature's element types, a sub-feature is nodes, ways and relations
    assert.match(
        buildSubCountQuery({ elementTypes: 'rel', rawTagExpression: '[route=subway]', subFilters: SPACES }),
        /^\[out:json\]\[timeout:60\];\nnwr\["amenity"="parking_space"\];\nout count;$/
    );
});

test('no sub-feature means no sub-feature count', () => {
    assert.equal(buildSubCountQuery({ filters: LOTS, area: SEATTLE }), '');
    assert.equal(buildSubCountQuery({ filters: LOTS, area: SEATTLE, subFilters: [] }), '');
    assert.equal(buildSqlSubCountQuery({ filters: LOTS, area: SEATTLE, subFilters: null }), '');
    assert.equal(buildCuratedSubCountQuery('parking_lots', 'seattle', null), '');
    assert.equal(buildCuratedSqlSubCount('parking_lots', 'seattle', []), '');
});

test('Postpass: the sub-feature count wraps the sub-feature SELECTs of the union, shapes and nodes included', () => {
    for (const shape of ['geometry', 'tag']) {
        const union = buildSqlGeomQuery({ filters: LOTS, area: SEATTLE, shape, subFilters: SPACES });
        const parts = union.split('\nUNION ALL\n');
        assert.equal(parts.length, 3, `${shape}: shapes, then nodes`);
        const prefix = shape === 'tag' ? union.slice(0, union.indexOf('SELECT p.')) : '';

        assert.equal(
            buildSqlSubCountQuery({ filters: LOTS, extraWhere: 'ST_NPoints(p.geom) > 50', elementTypes: 'way', area: SEATTLE, shape, subFilters: SPACES }),
            `${prefix}SELECT count(*) AS total FROM (
${parts[1]}
UNION ALL
${parts[2]}
) t`,
            shape
        );
    }
});

test('the curated helpers count only where the query has a sub-feature half', () => {
    assert.equal(
        buildCuratedSubCountQuery('parking_lots', 'seattle', SPACES),
        `[out:json];
rel(237385);
map_to_area->.searchArea;
nwr(area.searchArea)["amenity"="parking_space"];
out count;`
    );
    // Hand-written Overpass queries have no place for a sub-feature
    assert.equal(buildCuratedSubCountQuery('subway_routes', 'nyc', SPACES), '');
    assert.equal(buildCuratedSubCountQuery('large_flowerbeds', 'seattle', SPACES), '');
    // ...nor does a named subway network on Postpass, which has no area
    assert.equal(buildCuratedSqlSubCount('subway_routes', 'nyc', SPACES), '');
    assert.match(buildCuratedSqlSubCount('parking_lots', 'seattle', SPACES), /"parking_space"/);
    assert.equal(buildCuratedSubCountQuery('parking_lots', 'nowhere', SPACES), '');
});

test('the plan carries a sub-feature count whenever it fetches sub-features, and keeps its own count as it was', () => {
    for (const backend of ['overpass', 'postpass']) {
        const bare = buildQueryPlan(parking, seattle, { backend });
        assert.equal(bare.subCountQuery, '', `${backend}: nothing to count without a sub-feature`);

        const withSpaces = buildQueryPlan(parking, seattle, { backend, subFilters: SPACES });
        assert.equal(withSpaces.countQuery, bare.countQuery, `${backend}: the main count is unchanged`);
        assert.match(withSpaces.subCountQuery, /parking_space/);
        assert.doesNotMatch(withSpaces.subCountQuery, /"parking"[^_]/, `${backend}: the lots are not in it`);
        // A curated feature in a curated area is still not counted itself
        assert.equal(withSpaces.needsCount, false);

        const free = buildQueryPlan({ kind: 'free', filters: LOTS, elementTypes: 'wr' }, seattle, { backend, subFilters: SPACES });
        assert.equal(free.needsCount, true);
        assert.match(free.subCountQuery, /parking_space/);
    }

    // On Overpass the sub-count matches the union's settings: none for a
    // curated query, the default timeout for a typed one
    assert.match(buildQueryPlan(parking, seattle, { subFilters: SPACES }).subCountQuery, /^\[out:json\];\n/);
    assert.match(
        buildQueryPlan({ kind: 'free', filters: LOTS, elementTypes: 'wr' }, seattle, { subFilters: SPACES }).subCountQuery,
        /^\[out:json\]\[timeout:60\];\n/
    );

    // The Postpass sub-count is written in the shape the plan was built for
    const tag = buildQueryPlan(parking, seattle, { backend: 'postpass', shape: 'tag', subFilters: SPACES });
    assert.match(tag.subCountQuery, /^WITH a AS MATERIALIZED/);

    // Where the query has no sub-feature half, there is nothing to count
    const subway = buildQueryPlan({ kind: 'curated', key: 'subway_routes' }, { kind: 'curated', key: 'nyc' }, { subFilters: SPACES });
    assert.equal(subway.subCountQuery, '');
});

test('the size rules: limits are exclusive, and a missing count never blocks', () => {
    assert.deepEqual(judgeSearchSize(null, null), { verdict: 'run', mainLarge: false, subLarge: false });
    assert.deepEqual(judgeSearchSize(MAX_UNWARNED_RESULTS, MAX_UNWARNED_SUB_FEATURES), { verdict: 'run', mainLarge: false, subLarge: false });
    assert.deepEqual(judgeSearchSize(MAX_UNWARNED_RESULTS + 1, null), { verdict: 'large', mainLarge: true, subLarge: false });
    assert.deepEqual(judgeSearchSize(null, MAX_UNWARNED_SUB_FEATURES + 1), { verdict: 'large', mainLarge: false, subLarge: true });
    assert.deepEqual(judgeSearchSize(207, 91993), { verdict: 'large', mainLarge: false, subLarge: true });
    assert.deepEqual(judgeSearchSize(5144, 30877), { verdict: 'large', mainLarge: true, subLarge: true });
    assert.deepEqual(judgeSearchSize(223, 4722), { verdict: 'run', mainLarge: false, subLarge: false });
    // Nothing to put the sub-features in
    assert.deepEqual(judgeSearchSize(0, 91993), { verdict: 'empty', mainLarge: false, subLarge: false });
    // Zero sub-features is not an empty search
    assert.equal(judgeSearchSize(10, 0).verdict, 'run');
});

test('the sub-feature limit is the higher one', () => {
    assert.ok(MAX_UNWARNED_SUB_FEATURES > MAX_UNWARNED_RESULTS);
});

test('the warning says which half is large', () => {
    const n = value => value.toLocaleString();

    // The feature alone: the words the app has always used
    const main = describeSizeWarning(4955, null, judgeSearchSize(4955, null));
    assert.equal(main.heading, 'That is a lot of features');
    assert.equal(main.detail, `This search matches ${n(4955)} features. Drawing that many will make the page very slow.`);
    assert.equal(main.suggestion, 'Try a smaller area, or narrow the feature down.');

    // The sub-features alone, with and without a count of the features
    const sub = describeSizeWarning(207, 91993, judgeSearchSize(207, 91993));
    assert.match(sub.detail, /sub-features that are large/);
    assert.ok(sub.detail.includes(`fetch ${n(91993)} sub-features to place inside its 207 features`));
    assert.match(sub.suggestion, /Sub-feature field/);

    const uncounted = describeSizeWarning(null, 30877, judgeSearchSize(null, 30877));
    assert.ok(uncounted.detail.includes(`fetch ${n(30877)} sub-features.`));
    assert.doesNotMatch(uncounted.detail, /inside its/);

    const one = describeSizeWarning(1, 25000, judgeSearchSize(1, 25000));
    assert.ok(one.detail.includes('inside its 1 feature.'));

    // Both
    const both = describeSizeWarning(5144, 30877, judgeSearchSize(5144, 30877));
    assert.ok(both.detail.includes(`matches ${n(5144)} features, and would also fetch ${n(30877)} sub-features`));
    assert.match(both.suggestion, /feature and the sub-feature/);
});

test('curated parking lots are offered only where the lots stay under the warning limit', () => {
    const areas = getValidAreasForFeature('parking_lots').map(([key]) => key);

    assert.ok(Array.isArray(FEATURES.parking_lots.allowedAreas));
    assert.equal(areas.length, FEATURES.parking_lots.allowedAreas.length, 'every listed area exists');
    assert.ok(!areas.includes('tokyo'), '5,144 named lots, and a curated pair is not counted');
    assert.ok(!areas.includes('world'));
    assert.ok(areas.includes('seattle'));
});
