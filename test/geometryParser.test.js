/**
 * geometryParser.test.js
 * Runs the parser over the fixtures in test/data and checks what comes out.
 * The counts pin the merging behaviour those fixtures were collected for.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The parser validates OSM colours through a canvas; give it a stand-in so it
// runs in Node. Hex colours never reach it, and that is all the fixtures use.
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

const { parseElements } = await import('../docs/js/geometryParser.js');
const { convertGeoJsonToElements } = await import('../docs/js/utils/geojsonConverter.js');

function load(name) {
    const data = JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8'));
    return name.endsWith('.geojson') ? convertGeoJsonToElements(data) : data.elements;
}

/** The parser logs colour conflicts; keep the test output quiet */
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

const types = geometries => [...new Set(geometries.map(g => g.geometry.type))].sort();

test('an Overpass multipolygon relation becomes one MultiPolygon', () => {
    const { geometries, warnings } = parseElements(load('huge_basin.json'));
    assert.equal(geometries.length, 1);
    assert.deepEqual(types(geometries), ['MultiPolygon']);
    assert.equal(warnings.length, 0);
});

for (const name of ['multipoly_1.geojson', 'multipoly_2.geojson', 'multipoly_3.geojson']) {
    test(`${name} parses to a single MultiPolygon`, () => {
        const { geometries } = parseElements(load(name));
        assert.equal(geometries.length, 1);
        assert.deepEqual(types(geometries), ['MultiPolygon']);
    });
}

test('the ways of a raceway merge into one connected component', () => {
    for (const name of ['merging_raceway_1.geojson', 'merging_raceway2_1.geojson', 'merging_maze_1.geojson']) {
        const { geometries, warnings } = parseElements(load(name));
        assert.equal(geometries.length, 1, name);
        assert.deepEqual(types(geometries), ['MultiLineString'], name);
        assert.equal(warnings.length, 0, name);
    }
});

test('grouping by name can split a component whose ways are named differently', () => {
    const elements = load('merging_raceway3_1.geojson');
    assert.equal(parseElements(elements).geometries.length, 1);
    const grouped = parseElements(elements, { groupByEnabled: true, groupByTag: 'name' });
    assert.equal(grouped.geometries.length, 2);
    assert.deepEqual(types(grouped.geometries), ['LineString', 'MultiLineString']);
});

test('a chain of kerb ways merges into one LineString', () => {
    const { geometries } = parseElements(load('merging_kerb_yellow_1.geojson'));
    assert.equal(geometries.length, 1);
    assert.deepEqual(types(geometries), ['LineString']);
});

test('colour conflicts inside a component are reported as warnings', () => {
    const elements = load('parsing_warning_undefined-many_kerbs.geojson');
    const plain = quietly(() => parseElements(elements));
    assert.equal(plain.geometries.length, 33);
    assert.equal(plain.warnings.length, 4);
    assert.ok(plain.warnings.every(w => w.type === 'color_conflict' && w.osmType === 'component' && w.reason));

    // Grouping by colour keeps differently coloured ways apart, so no conflicts
    const byColour = quietly(() => parseElements(elements, { groupByEnabled: true, groupByTag: 'colour' }));
    assert.equal(byColour.geometries.length, 38);
    assert.equal(byColour.warnings.length, 0);
});

test('every parsed geometry carries bounds, a node count and tags', () => {
    const { geometries } = parseElements(load('contrast_test_colored_geometries.geojson'));
    assert.equal(geometries.length, 40);
    for (const geom of geometries) {
        assert.ok(geom.bounds && Number.isFinite(geom.bounds.width));
        assert.ok(geom.nodeCount > 0);
        assert.equal(typeof geom.tags, 'object');
    }
});

test('a response with no elements parses to nothing', () => {
    assert.deepEqual(parseElements([]), { geometries: [], warnings: [] });
});
