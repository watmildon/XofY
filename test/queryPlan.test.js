/**
 * queryPlan.test.js
 * Tests for turning a committed "X of Y" selection into a query, its count
 * form, and whether the guardrail applies.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildQueryPlan,
    needsCountFirst,
    shapeForTagCount,
    unsupportedPostpassKeys,
    RARE_TAG_THRESHOLD
} from '../docs/js/search/queryPlan.js';
import { parseTagExpression } from '../docs/js/search/tagParser.js';
import { FEATURES } from '../docs/js/config/features.js';

const POOLS = { kind: 'curated', key: 'swimming_pools' };
const FLOWERBEDS = { kind: 'curated', key: 'large_flowerbeds' };
const FREE_POOLS = {
    kind: 'free',
    filters: [{ key: 'leisure', op: '=', value: 'swimming_pool' }],
    elementTypes: 'wr'
};

const PHOENIX = { kind: 'curated', key: 'phoenix' };
const WORLD = { kind: 'curated', key: 'world' };
const NICE = { kind: 'place', ref: { osmType: 'relation', osmId: 170100 } };

test('curated feature in a curated area: the query the app has always sent', () => {
    const plan = buildQueryPlan(POOLS, PHOENIX);

    assert.equal(plan.query, `[out:json];
rel(111257);
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out geom;`);
    assert.equal(plan.countQuery, plan.query.replace('out geom;', 'out count;'));
    assert.equal(plan.needsCount, false, 'a known feature in a known area needs no check');
    assert.equal(plan.groupBy, '');
});

test('curated feature in a searched area', () => {
    const plan = buildQueryPlan(POOLS, NICE);

    assert.equal(plan.query, `[out:json];
rel(170100);
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out geom;`);
    assert.equal(plan.countQuery, plan.query.replace('out geom;', 'out count;'));
    assert.equal(plan.needsCount, true);
});

test('free-form feature in a curated area', () => {
    const plan = buildQueryPlan(FREE_POOLS, PHOENIX);

    assert.equal(plan.query, `[out:json][timeout:60];
rel(111257);
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out geom;`);
    assert.equal(plan.countQuery, plan.query.replace('out geom;', 'out count;'));
    assert.equal(plan.needsCount, true);
    assert.equal(plan.groupBy, null, 'a free-form search leaves the grouping hint alone');
});

test('free-form feature in a searched area', () => {
    const plan = buildQueryPlan(FREE_POOLS, NICE);

    assert.match(plan.query, /^rel\(170100\);$/m);
    assert.equal(plan.countQuery, plan.query.replace('out geom;', 'out count;'));
    assert.equal(plan.needsCount, true);
});

test('the world is only searched when it was explicitly chosen', () => {
    const curated = buildQueryPlan({ kind: 'curated', key: 'jetsprint_lakes' }, WORLD);
    assert.equal(curated.query, `[out:json];
wr["sport"="jetsprint"]["natural"="water"];
out geom;`);

    const free = buildQueryPlan(FREE_POOLS, WORLD);
    assert.equal(free.query, `[out:json][timeout:60];
wr["leisure"="swimming_pool"];
out geom;`);
    assert.equal(free.needsCount, true, 'a planet-wide free-form search is exactly what to check');
});

test('element types come from the feature', () => {
    const lineOnly = buildQueryPlan(
        { kind: 'free', filters: [{ key: 'highway', op: '=', value: 'primary' }], elementTypes: 'way' },
        PHOENIX
    );
    assert.match(lineOnly.query, /^way\(area\.searchArea\)/m);

    // No element types given falls back to the builder's default
    const fallback = buildQueryPlan(
        { kind: 'free', filters: [{ key: 'highway', op: '=', value: 'primary' }] },
        PHOENIX
    );
    assert.match(fallback.query, /^wr\(area\.searchArea\)/m);
});

test('self-limiting features skip the guardrail however they are searched', () => {
    assert.equal(buildQueryPlan(FLOWERBEDS, PHOENIX).needsCount, false);
    assert.equal(buildQueryPlan(FLOWERBEDS, NICE).needsCount, false);
    assert.equal(buildQueryPlan(FLOWERBEDS, NICE).countQuery, '', 'and have no count form');
    assert.match(buildQueryPlan(FLOWERBEDS, NICE).query, /foreach/);

    assert.equal(needsCountFirst(FLOWERBEDS, NICE), false);
    assert.equal(needsCountFirst(POOLS, PHOENIX), false);
    assert.equal(needsCountFirst(POOLS, NICE), true);
    assert.equal(needsCountFirst(FREE_POOLS, PHOENIX), true);
});

test('a named subway network has no count form, because the area is ignored', () => {
    const plan = buildQueryPlan({ kind: 'curated', key: 'subway_routes' }, { kind: 'curated', key: 'nyc' });

    assert.match(plan.query, /network="NYC Subway"/);
    assert.equal(plan.countQuery, '');
    assert.equal(plan.needsCount, false);
});

test('an incomplete or unusable selection has no plan', () => {
    assert.equal(buildQueryPlan(null, PHOENIX), null);
    assert.equal(buildQueryPlan(POOLS, null), null);
    assert.equal(buildQueryPlan(null, null), null);
    assert.equal(buildQueryPlan({ kind: 'curated', key: 'nope' }, PHOENIX), null);
    assert.equal(buildQueryPlan(POOLS, { kind: 'curated', key: 'atlantis' }), null);
    assert.equal(buildQueryPlan({ kind: 'free', filters: [] }, PHOENIX), null);
    assert.equal(buildQueryPlan({ kind: 'free' }, PHOENIX), null);
});

test('a bad area reference is refused rather than queried', () => {
    for (const ref of [{ osmType: 'node', osmId: 1 }, { osmType: 'relation', osmId: '1);out;//' }]) {
        assert.throws(() => buildQueryPlan(FREE_POOLS, { kind: 'place', ref }));
        assert.throws(() => buildQueryPlan(POOLS, { kind: 'place', ref }));
    }
});

test('the backend option decides which language a plan is in', () => {
    // Asking for Overpass explicitly is what the plan already was
    assert.deepEqual(buildQueryPlan(POOLS, PHOENIX, { backend: 'overpass' }), buildQueryPlan(POOLS, PHOENIX));
    assert.equal(buildQueryPlan(POOLS, PHOENIX).backend, 'overpass');

    // An unrecognised backend is Overpass rather than nothing at all
    assert.equal(buildQueryPlan(POOLS, PHOENIX, { backend: 'nonsense' }).query,
        buildQueryPlan(POOLS, PHOENIX).query);

    const plan = buildQueryPlan(POOLS, PHOENIX, { backend: 'postpass' });

    assert.equal(plan.backend, 'postpass');
    assert.equal(plan.query, `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=111257) a
WHERE p.tags @> '{"leisure":"swimming_pool"}'::jsonb
  AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)`);
    assert.equal(plan.countQuery, `SELECT count(*) AS total FROM (\n${plan.query}\n) t`);
    assert.equal(plan.needsCount, false, 'the guardrail rule is the same on both backends');
    assert.equal(plan.groupBy, '');
});

test('a Postpass plan says which tag to size before choosing a shape', () => {
    const curated = buildQueryPlan(POOLS, NICE, { backend: 'postpass' });
    assert.deepEqual(curated.estimateFilters, [{ key: 'leisure', op: '=', value: 'swimming_pool' }]);

    const free = buildQueryPlan(FREE_POOLS, NICE, { backend: 'postpass' });
    assert.deepEqual(free.estimateFilters, FREE_POOLS.filters);

    // With no boundary, both shapes are the same statement and there is
    // nothing worth asking taginfo
    assert.deepEqual(buildQueryPlan(FREE_POOLS, WORLD, { backend: 'postpass' }).estimateFilters, []);
    assert.deepEqual(
        buildQueryPlan({ kind: 'curated', key: 'jetsprint_lakes' }, WORLD, { backend: 'postpass' }).estimateFilters,
        []
    );
    assert.deepEqual(
        buildQueryPlan({ kind: 'curated', key: 'subway_routes' }, { kind: 'curated', key: 'nyc' },
            { backend: 'postpass' }).estimateFilters,
        [],
        'a named network is not bounded by an area'
    );

    // The Overpass plan has no such field to get out of step
    assert.equal(buildQueryPlan(POOLS, NICE).estimateFilters, undefined);
});

test('the requested shape is the one that gets built', () => {
    const geometry = buildQueryPlan(FREE_POOLS, NICE, { backend: 'postpass', shape: 'geometry' });
    const tagged = buildQueryPlan(FREE_POOLS, NICE, { backend: 'postpass', shape: 'tag' });

    assert.match(geometry.query, /^SELECT p\.osm_type/);
    assert.match(tagged.query, /^WITH a AS MATERIALIZED \(/);
    assert.match(tagged.countQuery, /^WITH a AS MATERIALIZED \(/);

    // Geometry-driven is what a plan builds when nothing was decided yet
    assert.equal(buildQueryPlan(FREE_POOLS, NICE, { backend: 'postpass' }).query, geometry.query);
});

test('a tag count picks the shape, and not knowing means geometry-driven', () => {
    assert.equal(RARE_TAG_THRESHOLD, 100000);

    // California's 779 water slides need the tag-driven shape...
    assert.equal(shapeForTagCount(779), 'tag');
    assert.equal(shapeForTagCount(RARE_TAG_THRESHOLD - 1), 'tag');
    assert.equal(shapeForTagCount(0), 'tag');

    // ...and its 96,601 swimming pools time out under it
    assert.equal(shapeForTagCount(3048651), 'geometry');
    assert.equal(shapeForTagCount(RARE_TAG_THRESHOLD), 'geometry');

    // Not knowing is treated as common, which is the shape that only gets
    // slower rather than never finishing
    assert.equal(shapeForTagCount(null), 'geometry');
    assert.equal(shapeForTagCount(undefined), 'geometry');
    assert.equal(shapeForTagCount(NaN), 'geometry');
    assert.equal(shapeForTagCount(-1), 'geometry');
    assert.equal(shapeForTagCount('742'), 'geometry');
});

test('a plan says which tag keys Postpass cannot answer for', () => {
    // osm2pgsql reads `type` to decide which table a relation belongs in and
    // does not keep it, so `tags @> '{"type":...}'` is false for every row
    assert.deepEqual(unsupportedPostpassKeys([{ key: 'type', op: '=', value: 'multipolygon' }]), ['type']);
    assert.deepEqual(unsupportedPostpassKeys([{ key: 'type', op: 'exists' }]), ['type']);
    assert.deepEqual(
        unsupportedPostpassKeys([{ key: 'type', op: '=', value: 'a' }, { key: 'type', op: '!=', value: 'b' }]),
        ['type'],
        'named once however many filters mention it'
    );
    assert.deepEqual(unsupportedPostpassKeys([{ key: 'leisure', op: '=', value: 'park' }]), []);
    assert.deepEqual(unsupportedPostpassKeys([]), []);
    assert.deepEqual(unsupportedPostpassKeys(null), []);

    const typed = { kind: 'free', ...parseTagExpression('type=multipolygon natural=water'), elementTypes: 'rel' };
    assert.deepEqual(buildQueryPlan(typed, NICE, { backend: 'postpass' }).unsupportedKeys, ['type']);

    // An ordinary search has nothing to report, and Overpass never does
    assert.deepEqual(buildQueryPlan(FREE_POOLS, NICE, { backend: 'postpass' }).unsupportedKeys, []);
    assert.deepEqual(buildQueryPlan(POOLS, NICE, { backend: 'postpass' }).unsupportedKeys, []);
    assert.equal(buildQueryPlan(typed, NICE).unsupportedKeys, undefined);

    // No curated feature searches for it, and if one ever did the client would
    // now be told rather than showing an empty result
    for (const featureKey of Object.keys(FEATURES)) {
        assert.deepEqual(
            buildQueryPlan({ kind: 'curated', key: featureKey }, NICE, { backend: 'postpass' }).unsupportedKeys,
            [],
            featureKey
        );
    }
});

test('a curated feature with no preset carries its own rarity', () => {
    // Nothing local knows how rare basin=cooling is, and taginfo may be down
    // exactly when it matters, so the feature says so itself
    const basins = buildQueryPlan({ kind: 'curated', key: 'cooling_basins' }, NICE, { backend: 'postpass' });

    assert.equal(basins.estimateCount, FEATURES.cooling_basins.tagCount);
    assert.equal(shapeForTagCount(basins.estimateCount), 'tag', 'rare enough for the tag-driven shape');

    // Everything else has nothing baked in and is sized from elsewhere
    assert.equal(buildQueryPlan(POOLS, NICE, { backend: 'postpass' }).estimateCount, null);
    assert.equal(buildQueryPlan(FREE_POOLS, NICE, { backend: 'postpass' }).estimateCount, null);
    assert.equal(buildQueryPlan(POOLS, NICE).estimateCount, undefined, 'Overpass has no such field');

    // Whatever a feature bakes in has to be a usable number
    for (const [key, feature] of Object.entries(FEATURES)) {
        if (feature.tagCount !== undefined) {
            assert.ok(Number.isFinite(feature.tagCount) && feature.tagCount >= 0, key);
        }
    }
});

test('the curated specials plan on Postpass too', () => {
    const flowerbeds = buildQueryPlan(FLOWERBEDS, NICE, { backend: 'postpass' });

    assert.match(flowerbeds.query, /ST_NPoints\(p\.geom\) > 50/);
    assert.equal(flowerbeds.needsCount, false, 'still self-limiting');
    // Unlike the foreach it mirrors, the SQL form really can be counted
    assert.match(flowerbeds.countQuery, /^SELECT count\(\*\) AS total FROM \(/);

    const subway = buildQueryPlan({ kind: 'curated', key: 'subway_routes' },
        { kind: 'curated', key: 'nyc' }, { backend: 'postpass' });

    assert.match(subway.query, /FROM postpass_line p/);
    assert.match(subway.query, /'\{"network":"NYC Subway"\}'::jsonb/);
    assert.equal(subway.needsCount, false);
});

test('an unusable selection has no plan on either backend', () => {
    for (const backend of ['overpass', 'postpass']) {
        assert.equal(buildQueryPlan(null, PHOENIX, { backend }), null);
        assert.equal(buildQueryPlan(POOLS, null, { backend }), null);
        assert.equal(buildQueryPlan({ kind: 'curated', key: 'nope' }, PHOENIX, { backend }), null);
        assert.equal(buildQueryPlan(POOLS, { kind: 'curated', key: 'atlantis' }, { backend }), null);
        assert.equal(buildQueryPlan({ kind: 'free', filters: [] }, PHOENIX, { backend }), null);
        assert.equal(buildQueryPlan({ kind: 'free' }, PHOENIX, { backend }), null);

        for (const ref of [{ osmType: 'node', osmId: 1 }, { osmType: 'relation', osmId: '1);--' }]) {
            assert.throws(() => buildQueryPlan(FREE_POOLS, { kind: 'place', ref }, { backend }));
            assert.throws(() => buildQueryPlan(POOLS, { kind: 'place', ref }, { backend }));
        }
    }
});
