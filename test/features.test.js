/**
 * features.test.js
 * Tests for the curated feature/area config: query building (which must keep
 * producing exactly the text the app has always sent), area resolution, and
 * the flags portion 3 needs.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FEATURES,
    AREAS,
    buildCuratedQuery,
    buildCuratedCountQuery,
    getValidAreasForFeature,
    getAreaRef,
    isKnownArea,
    isSelfLimitingFeature
} from '../docs/js/config/features.js';

const NICE = { osmType: 'relation', osmId: 170100 };

test('curated queries keep their exact historical text', () => {
    assert.equal(
        buildCuratedQuery('swimming_pools', 'phoenix'),
        `[out:json];
rel(111257);
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out geom;`
    );

    assert.equal(
        buildCuratedQuery('primary_highways', 'seattle'),
        `[out:json];
rel(237385);
map_to_area->.searchArea;
way(area.searchArea)["highway"="primary"][name];
out geom;`
    );

    // World: no area filter
    assert.equal(
        buildCuratedQuery('jetsprint_lakes', 'world'),
        `[out:json];
wr["sport"="jetsprint"]["natural"="water"];
out geom;`
    );

    // Custom query with foreach
    assert.equal(
        buildCuratedQuery('large_flowerbeds', 'france'),
        `[out:json];
rel(2202162);
map_to_area->.searchArea;
way(area.searchArea)["landuse"="flowerbed"];
foreach (
  way._(if:count_members() > 50);
  out geom;
);`
    );

    assert.equal(
        buildCuratedQuery('large_flowerbeds', 'world'),
        `[out:json];
way["landuse"="flowerbed"];
foreach (
  way._(if:count_members() > 50);
  out geom;
);`
    );

    // Custom query keyed on the area
    assert.equal(
        buildCuratedQuery('subway_routes', 'nyc'),
        `[out:json];
rel[route=subway][network="NYC Subway"];
out geom;`
    );
});

test('a curated feature can be searched in a place found by search', () => {
    assert.equal(
        buildCuratedQuery('swimming_pools', NICE),
        `[out:json];
rel(170100);
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out geom;`
    );

    // A closed way works as an area too (campuses, theme parks)
    assert.equal(
        buildCuratedQuery('churches', { osmType: 'way', osmId: 4567 }),
        `[out:json];
way(4567);
map_to_area->.searchArea;
wr(area.searchArea)["building"="church"];
out geom;`
    );
});

test('the flowerbed custom query works with a searched area', () => {
    // large_flowerbeds is customQuery with allowedAreas: null, so
    // "Large Flowerbeds of <searched place>" is genuinely reachable
    assert.equal(FEATURES.large_flowerbeds.allowedAreas, null);
    assert.equal(
        buildCuratedQuery('large_flowerbeds', NICE),
        `[out:json];
rel(170100);
map_to_area->.searchArea;
way(area.searchArea)["landuse"="flowerbed"];
foreach (
  way._(if:count_members() > 50);
  out geom;
);`
    );

    assert.equal(
        buildCuratedQuery('large_flowerbeds', { osmType: 'way', osmId: 99 }),
        `[out:json];
way(99);
map_to_area->.searchArea;
way(area.searchArea)["landuse"="flowerbed"];
foreach (
  way._(if:count_members() > 50);
  out geom;
);`
    );
});

test('unusable selections build nothing', () => {
    assert.equal(buildCuratedQuery('nope', 'seattle'), '');
    assert.equal(buildCuratedQuery('parks', 'nope'), '');
    assert.equal(buildCuratedQuery('parks', ''), '');
    assert.equal(buildCuratedQuery('parks', undefined), '');
    assert.equal(buildCuratedQuery('parks', {}), '');
    assert.equal(buildCuratedQuery('parks', { osmType: 'relation' }), '');
    assert.throws(() => buildCuratedQuery('parks', { osmType: 'relation', osmId: 'x);out;' }), /Invalid OSM id/);
});

test('area lookup separates "the world" from "no such area"', () => {
    assert.deepEqual(getAreaRef('paris'), { osmType: 'relation', osmId: 7444 });

    // null really does mean planet-wide...
    assert.equal(getAreaRef('world'), null);

    // ...so an unknown key must not be able to produce it
    assert.throws(() => getAreaRef('atlantis'), /Unknown area: atlantis/);
    assert.throws(() => getAreaRef(''), /Unknown area/);
    assert.throws(() => getAreaRef(undefined), /Unknown area/);
    assert.throws(() => getAreaRef('toString'), /Unknown area/);

    assert.ok(isKnownArea('world'));
    assert.ok(isKnownArea('paris'));
    assert.ok(!isKnownArea('atlantis'));
    assert.ok(!isKnownArea('toString'));
});

test('self-limiting features can be recognised without naming them', () => {
    assert.ok(isSelfLimitingFeature('large_flowerbeds'));
    assert.ok(!isSelfLimitingFeature('parks'));
    assert.ok(!isSelfLimitingFeature('subway_routes'));
    assert.ok(!isSelfLimitingFeature('nope'));

    // Whatever carries customQuery is what the guardrail should skip
    const selfLimiting = Object.keys(FEATURES).filter(key => FEATURES[key].customQuery);
    assert.deepEqual(selfLimiting.filter(key => !isSelfLimitingFeature(key)), []);
});

test('valid areas still follow allowedAreas and minAdminLevel', () => {
    assert.deepEqual(
        getValidAreasForFeature('roller_coasters').map(([key]) => key),
        ['disney_world']
    );
    assert.deepEqual(getValidAreasForFeature('jetsprint_lakes').map(([key]) => key), ['world']);
    assert.deepEqual(getValidAreasForFeature('nope'), []);

    // Churches are city-level only, so the world and countries drop out
    const churchAreas = getValidAreasForFeature('churches').map(([key]) => key);
    assert.ok(!churchAreas.includes('world'));
    assert.ok(!churchAreas.includes('usa'));
    assert.ok(churchAreas.includes('seattle'));

    for (const [key, area] of getValidAreasForFeature('cooling_basins')) {
        assert.ok(AREAS[key], `${key} should be a known area`);
        assert.ok(area.adminLevel >= FEATURES.cooling_basins.minAdminLevel);
    }
});

test('area references are validated the same way on both query paths', () => {
    // A node has no area for map_to_area to build, so neither the standard
    // path nor the customQuery path may quietly treat it as a relation
    for (const featureKey of ['swimming_pools', 'large_flowerbeds']) {
        assert.throws(
            () => buildCuratedQuery(featureKey, { osmType: 'node', osmId: 42 }),
            /Unsupported OSM area type/,
            `${featureKey} accepted a node area`
        );
        assert.throws(
            () => buildCuratedQuery(featureKey, { osmType: 'relation', osmId: '42);out;//' }),
            /Invalid OSM id/
        );
        assert.throws(
            () => buildCuratedQuery(featureKey, { osmType: 'relation', osmId: -1 }),
            /Invalid OSM id/
        );
    }

    // The spellings Nominatim returns work on both paths
    assert.match(buildCuratedQuery('large_flowerbeds', { osmType: 'R', osmId: 7 }), /^rel\(7\);$/m);
    assert.match(buildCuratedQuery('swimming_pools', { osmType: 'w', osmId: 7 }), /^way\(7\);$/m);
});

test('builds a count query for the guardrail', () => {
    assert.equal(
        buildCuratedCountQuery('swimming_pools', { osmType: 'relation', osmId: 170100 }),
        `[out:json];
rel(170100);
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out count;`
    );

    // Self-limiting features have nothing to count
    assert.equal(buildCuratedCountQuery('large_flowerbeds', 'france'), '');
    assert.equal(buildCuratedCountQuery('nope', 'france'), '');
    assert.equal(buildCuratedCountQuery('parks', 'nowhere'), '');

    // Nor do the named subway networks, whose query ignores the area entirely
    assert.equal(buildCuratedCountQuery('subway_routes', 'nyc'), '');
    assert.equal(buildCuratedCountQuery('subway_routes', 'tokyo'), '');
});

test('a count query differs from its own query only in the out statement', () => {
    // Otherwise the guardrail would be counting something else
    let checked = 0;

    for (const featureKey of Object.keys(FEATURES)) {
        for (const [areaKey] of getValidAreasForFeature(featureKey)) {
            const count = buildCuratedCountQuery(featureKey, areaKey);
            if (!count) {
                continue;
            }

            checked++;
            assert.equal(
                count.replace(/out count;$/, 'out geom;'),
                buildCuratedQuery(featureKey, areaKey),
                `${featureKey} of ${areaKey}`
            );
        }
    }

    assert.ok(checked > 100, `expected many countable combinations, checked ${checked}`);
});
