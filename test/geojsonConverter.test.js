/**
 * geojsonConverter.test.js
 * Tests for turning imported GeoJSON into Overpass-shaped elements.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { convertGeoJsonToElements } from '../docs/js/utils/geojsonConverter.js';

const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const hole = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]];

function feature(type, coordinates, extra = {}) {
    return { type: 'Feature', properties: { name: 'x' }, geometry: { type, coordinates }, ...extra };
}

function collection(...features) {
    return { type: 'FeatureCollection', features };
}

test('a LineString becomes a way with lon/lat geometry', () => {
    const [way] = convertGeoJsonToElements(collection(feature('LineString', [[10, 20], [11, 21]], { id: 7 })));
    assert.deepEqual(way, {
        type: 'way',
        id: 7,
        tags: { name: 'x' },
        geometry: [{ lon: 10, lat: 20 }, { lon: 11, lat: 21 }]
    });
});

test('a Polygon without holes becomes a closed way', () => {
    const [way] = convertGeoJsonToElements(collection(feature('Polygon', [square])));
    assert.equal(way.type, 'way');
    assert.equal(way.geometry.length, 5);
    assert.deepEqual(way.geometry[0], { lon: 0, lat: 0 });
});

test('a Polygon with holes becomes a multipolygon relation', () => {
    const [rel] = convertGeoJsonToElements(collection(feature('Polygon', [square, hole], { id: 3 })));
    assert.equal(rel.type, 'relation');
    assert.deepEqual(rel.tags, { name: 'x', type: 'multipolygon' });
    assert.deepEqual(rel.members.map(m => [m.ref, m.role, m.polygonGroup]), [
        ['3_ring_0', 'outer', 0],
        ['3_ring_1', 'inner', 0]
    ]);
});

test('a MultiLineString becomes one way per line', () => {
    const ways = convertGeoJsonToElements(collection(feature('MultiLineString', [[[0, 0], [1, 1]], [[2, 2], [3, 3]]], { id: 5 })));
    assert.deepEqual(ways.map(w => w.id), ['5_0', '5_1']);
    assert.ok(ways.every(w => w.type === 'way' && w.tags.name === 'x'));
});

test('a MultiPolygon keeps each ring with its own polygon', () => {
    const shifted = ring => ring.map(([x, y]) => [x + 5, y]);
    const [rel] = convertGeoJsonToElements(collection(
        feature('MultiPolygon', [[square, hole], [shifted(square)]], { id: 9 })
    ));
    assert.equal(rel.type, 'relation');
    assert.deepEqual(rel.members.map(m => [m.ref, m.role, m.polygonGroup]), [
        ['9_member_0', 'outer', 0],
        ['9_member_1', 'inner', 0],
        ['9_member_2', 'outer', 1]
    ]);
});

test('points and features without geometry are skipped', () => {
    const elements = convertGeoJsonToElements(collection(
        feature('Point', [1, 2]),
        { type: 'Feature', properties: {} },
        { type: 'Feature', properties: {}, geometry: null },
        feature('LineString', [[0, 0], [1, 1]])
    ));
    assert.equal(elements.length, 1);
    assert.equal(elements[0].type, 'way');
});

test('ids fall back to a generated number and properties become tags', () => {
    const elements = convertGeoJsonToElements(collection(
        feature('LineString', [[0, 0], [1, 1]]),
        feature('LineString', [[0, 0], [1, 1]])
    ));
    assert.deepEqual(elements.map(e => e.id), [1000000, 1000001]);

    const [bare] = convertGeoJsonToElements(collection({
        type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
    }));
    assert.deepEqual(bare.tags, {});
});

test('a single Feature is accepted without a collection', () => {
    const elements = convertGeoJsonToElements(feature('Polygon', [square]));
    assert.equal(elements.length, 1);
});

test('a real test fixture converts to ways and relations only', () => {
    const geojson = JSON.parse(readFileSync(new URL('./data/multipoly_2.geojson', import.meta.url), 'utf8'));
    const elements = convertGeoJsonToElements(geojson);
    assert.ok(elements.length > 0);
    assert.ok(elements.every(e => e.type === 'way' || e.type === 'relation'));
    assert.ok(elements.every(e => e.type !== 'relation' || e.members.length > 0));
});
