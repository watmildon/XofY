/**
 * postpassResults.test.js
 * Tests for turning a Postpass GeoJSON response into Overpass-shaped elements,
 * against three responses captured from the live server, and for what the
 * geometry parser then makes of them.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The parser validates OSM colours through a canvas; give it a stand-in so it
// runs in Node, as test/geometryParser.test.js does
globalThis.document = {
    createElement() {
        let fill = '#000000';
        return {
            getContext() {
                return { set fillStyle(v) { fill = String(v); }, get fillStyle() { return fill; } };
            }
        };
    }
};

const {
    postpassToElements,
    dropRouteGapWarnings,
    synthesisedTagKeys
} = await import('../docs/js/search/postpassResults.js');
const { parseElements } = await import('../docs/js/geometryParser.js');

/**
 * Load a captured Postpass response
 * @param {string} name - File name in test/data
 * @returns {Object} Parsed FeatureCollection
 */
function fixture(name) {
    return JSON.parse(readFileSync(fileURLToPath(new URL(`./data/${name}`, import.meta.url)), 'utf8'));
}

/** The parser logs as it goes; keep the test output quiet */
function quietly(fn) {
    const { log, warn } = console;
    console.log = () => {};
    console.warn = () => {};
    try {
        return fn();
    } finally {
        console.log = log;
        console.warn = warn;
    }
}

// Swimming pools of Nice: closed ways, each a MultiPolygon of one ring
const POOLS = fixture('postpass-nice-pools.json');
// Subway routes of New York: relations, each a MultiLineString of many pieces
const SUBWAY = fixture('postpass-nyc-subway.json');
// Meadowbrook Pond, Seattle: a multipolygon relation with five holes in it
const POND = fixture('postpass-seattle-pond.json');

test('a way polygon becomes that way, with its own id and tags', () => {
    const elements = postpassToElements(POOLS);

    assert.equal(elements.length, 3);
    assert.deepEqual(elements.map(e => e.type), ['way', 'way', 'way']);
    assert.deepEqual(elements.map(e => e.id), [218686916, 218652660, 1548352030]);

    const first = elements[0];
    assert.equal(first.tags.leisure, 'swimming_pool');
    assert.equal(first.tags.access, 'private');
    // The identifying columns are not tags and must not be shown as tags
    assert.equal(first.tags.osm_type, undefined);
    assert.equal(first.tags.osm_id, undefined);

    // Geometry is {lat, lon} pairs, closed, in the order Postpass sent it
    assert.ok(first.geometry.length > 3);
    assert.deepEqual(first.geometry[0], first.geometry[first.geometry.length - 1]);
    assert.equal(first.geometry[0].lon, POOLS.features[0].geometry.coordinates[0][0][0][0]);
    assert.equal(first.geometry[0].lat, POOLS.features[0].geometry.coordinates[0][0][0][1]);
    assert.equal(first.members, undefined);
});

test('the parser draws those ways as filled polygons an OSM link can reach', () => {
    const { geometries, warnings } = quietly(() => parseElements(postpassToElements(POOLS)));

    assert.equal(geometries.length, 3);
    assert.deepEqual(warnings, []);
    assert.deepEqual([...new Set(geometries.map(g => g.geometry.type))], ['Polygon']);

    // What the detail modal builds its links from
    for (const geometry of geometries) {
        assert.equal(geometry.type, 'way');
        assert.ok(Number.isInteger(geometry.id) && geometry.id > 0);
    }
    assert.equal(
        `https://www.openstreetmap.org/${geometries[0].type}/${geometries[0].id}`,
        'https://www.openstreetmap.org/way/218686916'
    );
});

test('a multipolygon relation keeps its holes, and stays a relation', () => {
    const elements = postpassToElements(POND);

    assert.equal(elements.length, 1);
    const [pond] = elements;

    assert.equal(pond.type, 'relation');
    assert.equal(pond.id, 4048264);
    assert.equal(pond.tags.name, 'Meadowbrook Pond');
    assert.equal(pond.tags.natural, 'water');

    // Postpass drops the `type` tag, because osm2pgsql reads it to decide
    // which table a relation belongs in. The parser needs it back
    assert.equal(POND.features[0].properties.tags.type, undefined);
    assert.equal(pond.tags.type, 'multipolygon');

    // One outline and five holes, all in the same polygon group
    assert.equal(pond.members.length, 6);
    assert.deepEqual(pond.members.map(m => m.role), ['outer', 'inner', 'inner', 'inner', 'inner', 'inner']);
    assert.ok(pond.members.every(m => m.type === 'way' && m.polygonGroup === 0));
    assert.ok(pond.members.every(m => m.geometry.length > 2));

    const { geometries, warnings } = quietly(() => parseElements(elements));
    assert.equal(warnings.length, 0);
    assert.equal(geometries.length, 1);
    assert.equal(geometries[0].type, 'relation');
    assert.equal(geometries[0].id, 4048264);
    assert.equal(geometries[0].geometry.type, 'MultiPolygon');
    // One polygon, its outline plus the five holes
    assert.equal(geometries[0].geometry.coordinates.length, 1);
    assert.equal(geometries[0].geometry.coordinates[0].length, 6);
});

test('a route relation becomes members the route parser can draw', () => {
    const elements = postpassToElements(SUBWAY);

    assert.equal(elements.length, 3);
    assert.ok(elements.every(e => e.type === 'relation'));
    assert.deepEqual(elements.map(e => e.id), [2623983, 11245932, 11245930]);

    const [rockaway] = elements;
    assert.equal(rockaway.tags.route, 'subway');
    assert.equal(rockaway.tags.network, 'NYC Subway');
    // Restored for the same reason as the multipolygon's
    assert.equal(SUBWAY.features[0].properties.tags.type, undefined);
    assert.equal(rockaway.tags.type, 'route');

    // One member per piece of the line, in the order Postpass sent them
    assert.equal(rockaway.members.length, SUBWAY.features[0].geometry.coordinates.length);
    assert.ok(rockaway.members.every(m => m.type === 'way' && m.geometry.length > 1));

    const { geometries, warnings } = quietly(() => parseElements(elements));
    assert.equal(geometries.length, 3);
    assert.ok(geometries.every(g => g.geometry.type === 'MultiLineString'));
    assert.ok(geometries.every(g => g.type === 'relation'));

    // Postpass hands back one line per connected run of the route rather than
    // one per member way, so a route in more than one piece always reads as
    // "gaps between members" to the parser. The pieces really are disconnected,
    // so the warning is true; it is simply louder here than it is on Overpass,
    // where consecutive members usually do meet. Nothing is lost by it - all
    // three routes are drawn - but the client should expect these
    assert.ok(warnings.every(w => w.type === 'gap'), JSON.stringify(warnings));
    assert.deepEqual(warnings.map(w => w.osmId), [2623983, 11245932, 11245930]);

    // ...so the Postpass path drops them. Telling someone that all 109 of
    // their subway routes have gaps says nothing about their data
    assert.deepEqual(dropRouteGapWarnings(warnings), []);
    // The route's own colour comes through, as it does from Overpass
    assert.equal(geometries[1].color, '#7C858C');
    assert.equal(
        `https://www.openstreetmap.org/${geometries[0].type}/${geometries[0].id}`,
        'https://www.openstreetmap.org/relation/2623983'
    );
});

test('the same object in two tables is kept once, as its polygon', () => {
    // A boundary relation has a row in the line table and another in the
    // polygon table; the polygon is the one worth drawing
    const line = {
        type: 'Feature',
        properties: { osm_type: 'R', osm_id: 42, tags: { boundary: 'administrative' } },
        geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
    };
    const polygon = {
        type: 'Feature',
        properties: { osm_type: 'R', osm_id: 42, tags: { boundary: 'administrative' } },
        geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]] }
    };

    for (const features of [[line, polygon], [polygon, line]]) {
        const elements = postpassToElements({ type: 'FeatureCollection', features });

        assert.equal(elements.length, 1);
        assert.equal(elements[0].tags.type, 'multipolygon');
        assert.equal(elements[0].members.length, 1);
    }

    // A way and a relation with the same number are different objects
    const mixed = postpassToElements({
        type: 'FeatureCollection',
        features: [polygon, { ...polygon, properties: { ...polygon.properties, osm_type: 'W' } }]
    });
    assert.deepEqual(mixed.map(e => e.type), ['relation', 'way']);
});

test('a way whose geometry arrived in pieces is drawn as one way per piece', () => {
    // Postpass splits a way that crosses the antimeridian; there is no single
    // way geometry to give back, so the pieces are marked as what they are
    const elements = postpassToElements({
        type: 'FeatureCollection',
        features: [{
            properties: { osm_type: 'W', osm_id: 7, tags: { highway: 'primary' } },
            geometry: {
                type: 'MultiLineString',
                coordinates: [[[179, 0], [180, 0]], [[-180, 0], [-179, 0]]]
            }
        }]
    });

    assert.deepEqual(elements.map(e => e.id), ['7_0', '7_1']);
    assert.ok(elements.every(e => e.type === 'way'));
    assert.deepEqual(elements[1].geometry, [{ lon: -180, lat: 0 }, { lon: -179, lat: 0 }]);

    // A single piece is simply that way
    const whole = postpassToElements({
        type: 'FeatureCollection',
        features: [{
            properties: { osm_type: 'W', osm_id: 7, tags: { highway: 'primary' } },
            geometry: { type: 'MultiLineString', coordinates: [[[1, 0], [2, 0]]] }
        }]
    });
    assert.deepEqual(whole.map(e => e.id), [7]);
});

test('a relation of several polygons keeps them apart', () => {
    const elements = postpassToElements({
        type: 'FeatureCollection',
        features: [{
            properties: { osm_type: 'R', osm_id: 9, tags: { natural: 'water' } },
            geometry: {
                type: 'MultiPolygon',
                coordinates: [
                    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]]],
                    [[[5, 5], [6, 5], [6, 6], [5, 5]]]
                ]
            }
        }]
    });

    assert.deepEqual(
        elements[0].members.map(m => [m.role, m.polygonGroup]),
        [['outer', 0], ['inner', 0], ['outer', 1]]
    );

    const { geometries } = quietly(() => parseElements(elements));
    assert.equal(geometries[0].geometry.coordinates.length, 2, 'two polygons, not one with a stray hole');
    assert.equal(geometries[0].geometry.coordinates[0].length, 2, 'the hole belongs to the first');
});

test('rows that cannot be drawn are left out rather than half converted', () => {
    const junk = {
        type: 'FeatureCollection',
        features: [
            { properties: { osm_type: 'N', osm_id: 1, tags: {} }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { properties: { osm_type: 'W', osm_id: 0, tags: {} }, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } },
            { properties: { osm_type: 'W', osm_id: 'x', tags: {} }, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } },
            { properties: { osm_type: 'W', osm_id: 2 }, geometry: { type: 'MultiLineString', coordinates: [] } },
            { properties: { osm_type: 'R', osm_id: 3, tags: {} }, geometry: null },
            { properties: { osm_type: 'R', osm_id: 4, tags: {} }, geometry: { type: 'MultiPolygon', coordinates: [[[]]] } },
            {}
        ]
    };

    assert.deepEqual(postpassToElements(junk), []);
    assert.deepEqual(postpassToElements({ type: 'FeatureCollection', features: [] }), []);
    assert.deepEqual(postpassToElements({}), []);
    assert.deepEqual(postpassToElements(null), []);

    // A row with no tags at all is still an object worth drawing
    const untagged = postpassToElements({
        type: 'FeatureCollection',
        features: [{
            properties: { osm_type: 'W', osm_id: 5 },
            geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] }
        }]
    });
    assert.deepEqual(untagged, [{ type: 'way', id: 5, tags: {}, geometry: [{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }] }]);
});

test('only the gap notes are dropped, never a skip', () => {
    const warnings = [
        { message: 'Skipped relation 1: No members', osmType: 'relation', osmId: 1 },
        { message: 'Skipped route relation 2: No way members with geometry', type: 'skipped' },
        { message: 'Route relation 3 has gaps between members', type: 'gap' },
        { message: 'Route relation 4 has 140 members (may be slow to render)', type: 'size' },
        { reason: 'conflicting colours', type: 'color_conflict' }
    ];

    // A route in one piece has no gap note, so nothing here is about how many
    // routes there were - only about which warnings mean what
    assert.deepEqual(
        dropRouteGapWarnings(warnings).map(w => w.type),
        [undefined, 'skipped', 'size', 'color_conflict']
    );
    assert.deepEqual(dropRouteGapWarnings([]), []);
    assert.deepEqual(dropRouteGapWarnings(null), []);
    assert.deepEqual(dropRouteGapWarnings([null]), [null], 'nothing is inspected that is not there');
});

test('a type tag we had to invent is marked as ours, not the mapper\'s', () => {
    const [pond] = postpassToElements(POND);
    const [route] = postpassToElements(SUBWAY);

    assert.deepEqual(synthesisedTagKeys(pond.tags), ['type']);
    assert.deepEqual(synthesisedTagKeys(route.tags), ['type']);

    // The marker is not itself a tag: nothing that lists tags will show it
    assert.ok(!Object.keys(pond.tags).includes('__synthesisedTags'));
    assert.ok(!JSON.stringify(pond.tags).includes('__synthesisedTags'));
    assert.ok(Object.keys(pond.tags).includes('type'), 'the parser still needs it');

    // It survives the parser, which is where the detail modal reads tags from
    const { geometries } = quietly(() => parseElements(postpassToElements(POND)));
    assert.deepEqual(synthesisedTagKeys(geometries[0].tags), ['type']);
    assert.deepEqual(
        Object.keys(geometries[0].tags).filter(key => !synthesisedTagKeys(geometries[0].tags).includes(key)).sort(),
        ['name', 'natural', 'water'],
        'what the detail modal would list'
    );

    // A way has nothing invented, and neither has anything from Overpass
    const [pool] = postpassToElements(POOLS);
    assert.deepEqual(synthesisedTagKeys(pool.tags), []);
    assert.deepEqual(synthesisedTagKeys({ leisure: 'park' }), []);
    assert.deepEqual(synthesisedTagKeys(null), []);
    assert.deepEqual(synthesisedTagKeys(undefined), []);
});

test('a relation that already names its type keeps it', () => {
    // Postpass never sends one, but a response that did must not be overruled
    const elements = postpassToElements({
        type: 'FeatureCollection',
        features: [{
            properties: { osm_type: 'R', osm_id: 8, tags: { type: 'boundary', boundary: 'administrative' } },
            geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }
        }]
    });

    assert.equal(elements[0].tags.type, 'boundary');
});
