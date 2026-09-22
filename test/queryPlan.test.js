/**
 * queryPlan.test.js
 * Tests for turning a committed "X of Y" selection into a query, its count
 * form, and whether the guardrail applies.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQueryPlan, needsCountFirst } from '../docs/js/search/queryPlan.js';

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
