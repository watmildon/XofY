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
    buildCuratedSql,
    buildCuratedSqlCount,
    curatedSqlUsesArea,
    getCuratedFilters,
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

test('curated features build the Postpass SQL that was timed', () => {
    assert.equal(
        buildCuratedSql('swimming_pools', NICE),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=170100) a
WHERE p.tags @> '{"leisure":"swimming_pool"}'::jsonb
  AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)`
    );

    assert.equal(
        buildCuratedSql('water_slides', 'california', { shape: 'tag' }),
        `WITH a AS MATERIALIZED (
  SELECT ST_Subdivide(geom, 64) AS geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=165475)
SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p
WHERE p.tags @> '{"attraction":"water_slide"}'::jsonb
  AND p.osm_type='W'
  AND EXISTS (SELECT 1 FROM a WHERE p.geom && a.geom AND ST_Intersects(p.geom, a.geom))`
    );

    // The world: no boundary, so nothing for the shape to change
    assert.equal(
        buildCuratedSql('jetsprint_lakes', 'world'),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p
WHERE p.tags @> '{"sport":"jetsprint"}'::jsonb
  AND p.tags @> '{"natural":"water"}'::jsonb`
    );
    assert.equal(
        buildCuratedSql('jetsprint_lakes', 'world', { shape: 'tag' }),
        buildCuratedSql('jetsprint_lakes', 'world')
    );
});

test('the two features with a hand-written query have SQL twins', () => {
    // Overpass counts a way's members inside a foreach; SQL counts the points
    // of the geometry
    assert.equal(
        buildCuratedSql('large_flowerbeds', 'seattle'),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=237385) a
WHERE p.tags @> '{"landuse":"flowerbed"}'::jsonb
  AND p.osm_type='W'
  AND ST_NPoints(p.geom) > 50
  AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)`
    );

    // A named subway network is found by its name, like its Overpass twin, so
    // the area plays no part; route relations live in the line table
    assert.equal(
        buildCuratedSql('subway_routes', 'nyc'),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_line p
WHERE p.tags @> '{"route":"subway"}'::jsonb
  AND p.tags @> '{"network":"NYC Subway"}'::jsonb
  AND p.osm_type='R'`
    );

    // Tokyo is two networks, which Overpass writes as a union
    assert.equal(
        buildCuratedSql('subway_routes', 'tokyo'),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_line p
WHERE p.tags @> '{"route":"subway"}'::jsonb
  AND p.osm_type='R'
  AND (p.tags @> '{"network":"Tokyo Metro"}'::jsonb OR p.tags @> '{"network":"都営地下鉄"}'::jsonb)`
    );

    assert.equal(
        buildCuratedSql('subway_routes', 'singapore'),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_line p
WHERE p.tags @> '{"route":"subway"}'::jsonb
  AND p.tags @> '{"operator":"SMRT Trains"}'::jsonb
  AND p.osm_type='R'`
    );
});

test('the subway SQL twins name the same networks as the QL', () => {
    // The two lists are written out separately, so this is what keeps them
    // in step when one of them changes
    for (const areaKey of FEATURES.subway_routes.allowedAreas) {
        const ql = buildCuratedQuery('subway_routes', areaKey);
        const sql = buildCuratedSql('subway_routes', areaKey);

        assert.ok(ql, `${areaKey} has no curated QL`);
        assert.ok(sql, `${areaKey} has no curated SQL`);

        // Every network or operator the QL names appears in the SQL, and the
        // SQL names no others
        const fromQl = [...ql.matchAll(/\[(network|operator)="([^"]+)"\]/g)];
        const fromSql = [...sql.matchAll(/'\{"(network|operator)":"([^"]+)"\}'::jsonb/g)];

        assert.ok(fromQl.length > 0, `${areaKey} names no network in QL`);
        assert.deepEqual(
            fromSql.map(match => [match[1], match[2]]).sort(),
            fromQl.map(match => [match[1], match[2]]).sort(),
            areaKey
        );
    }
});

test('every curated selection builds SQL in both shapes', () => {
    let checked = 0;

    for (const featureKey of Object.keys(FEATURES)) {
        for (const [areaKey] of getValidAreasForFeature(featureKey)) {
            const geometry = buildCuratedSql(featureKey, areaKey, { shape: 'geometry' });
            const tagged = buildCuratedSql(featureKey, areaKey, { shape: 'tag' });

            assert.ok(geometry, `${featureKey} of ${areaKey} built no SQL`);
            assert.ok(tagged, `${featureKey} of ${areaKey} built no tag-shaped SQL`);

            // The two shapes differ exactly when a boundary is involved
            if (curatedSqlUsesArea(featureKey, areaKey)) {
                assert.notEqual(geometry, tagged, `${featureKey} of ${areaKey}`);
                assert.match(tagged, /^WITH a AS MATERIALIZED \(/);
            } else {
                assert.equal(geometry, tagged, `${featureKey} of ${areaKey}`);
            }

            // A count is the same statement, wrapped
            for (const shape of ['geometry', 'tag']) {
                const query = buildCuratedSql(featureKey, areaKey, { shape });
                const count = buildCuratedSqlCount(featureKey, areaKey, { shape });
                const withClause = query.startsWith('WITH')
                    ? query.slice(0, query.indexOf('SELECT p.osm_type'))
                    : '';

                assert.equal(
                    count,
                    `${withClause}SELECT count(*) AS total FROM (\n${query.slice(withClause.length)}\n) t`,
                    `${featureKey} of ${areaKey} (${shape})`
                );
            }
            checked++;
        }
    }

    assert.ok(checked > 100, `expected many curated combinations, checked ${checked}`);
});

test('a curated feature builds SQL for a place found by search', () => {
    assert.match(
        buildCuratedSql('churches', { osmType: 'way', osmId: 4567 }),
        /WHERE osm_type='W' AND osm_id=4567\) a/
    );
    assert.ok(curatedSqlUsesArea('churches', NICE));

    // The world and the named networks have no boundary to estimate for
    assert.ok(!curatedSqlUsesArea('jetsprint_lakes', 'world'));
    assert.ok(!curatedSqlUsesArea('subway_routes', 'nyc'));
    assert.ok(curatedSqlUsesArea('subway_routes', NICE), 'a searched place is not a named network');
});

test('unusable selections build no SQL either', () => {
    assert.equal(buildCuratedSql('nope', 'seattle'), '');
    assert.equal(buildCuratedSql('parks', 'nope'), '');
    assert.equal(buildCuratedSql('parks', {}), '');
    assert.equal(buildCuratedSqlCount('nope', 'seattle'), '');
    assert.equal(buildCuratedSqlCount('parks', 'nope'), '');
    assert.ok(!curatedSqlUsesArea('nope', 'seattle'));

    // Area references are validated the same way on both backends
    assert.throws(() => buildCuratedSql('parks', { osmType: 'node', osmId: 42 }), /Unsupported OSM area type/);
    assert.throws(() => buildCuratedSql('parks', { osmType: 'relation', osmId: '1);--' }), /Invalid OSM id/);
});

test('curated filters are available for the tag-count estimate', () => {
    assert.deepEqual(getCuratedFilters('swimming_pools'), [
        { key: 'leisure', op: '=', value: 'swimming_pool' }
    ]);
    assert.deepEqual(getCuratedFilters('race_tracks'), [
        { key: 'leisure', op: '=', value: 'track' },
        { key: 'athletics', op: 'missing' }
    ]);
    assert.deepEqual(getCuratedFilters('nope'), []);

    // Whatever the SQL filters on is what the estimate sizes
    for (const featureKey of Object.keys(FEATURES)) {
        const filters = getCuratedFilters(featureKey);
        assert.ok(filters.length > 0, `${featureKey} has no filters`);
        assert.ok(
            filters.some(filter => filter.op === '=' || filter.op === 'exists'),
            `${featureKey} has nothing taginfo could count`
        );
    }
});
