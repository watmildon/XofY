/**
 * subFeatures.test.js
 * Tests for sorting a result set into features and sub-features, and for
 * hanging each sub-feature on the features that enclose it.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    partitionElements,
    attachSubFeatures,
    isPointInGeometry
} from '../docs/js/geometry/subFeatures.js';
import { parseElements } from '../docs/js/geometryParser.js';

const LOT_FILTERS = [{ key: 'amenity', op: '=', value: 'parking' }];
const SPACE_FILTERS = [{ key: 'amenity', op: '=', value: 'parking_space' }];

/**
 * A closed way element for a rectangle
 * @param {number} id - Way id
 * @param {Object} tags - Its tags
 * @param {Array<number>} box - [minLon, minLat, maxLon, maxLat]
 * @returns {Object} Overpass-shaped way
 */
function rect(id, tags, [minLon, minLat, maxLon, maxLat]) {
    return {
        type: 'way',
        id,
        tags,
        geometry: [
            { lon: minLon, lat: minLat },
            { lon: maxLon, lat: minLat },
            { lon: maxLon, lat: maxLat },
            { lon: minLon, lat: maxLat },
            { lon: minLon, lat: minLat }
        ]
    };
}

/**
 * An open way element, a straight line
 * @param {number} id - Way id
 * @param {Object} tags - Its tags
 * @param {Array<Array<number>>} points - [lon, lat] pairs
 * @returns {Object} Overpass-shaped way
 */
function line(id, tags, points) {
    return { type: 'way', id, tags, geometry: points.map(([lon, lat]) => ({ lon, lat })) };
}

test('elements are sorted by their tags, and the feature wins a tie', () => {
    const lot = rect(1, { amenity: 'parking' }, [0, 0, 10, 10]);
    const space = rect(2, { amenity: 'parking_space' }, [1, 1, 2, 2]);
    const odd = rect(3, { amenity: 'parking', parking_space: 'yes' }, [20, 20, 30, 30]);

    const { main, sub } = partitionElements([lot, space, odd], {
        subFilters: SPACE_FILTERS,
        mainFilters: LOT_FILTERS
    });
    assert.deepEqual(main.map(e => e.id), [1, 3]);
    assert.deepEqual(sub.map(e => e.id), [2]);

    // A sub-feature filter the feature itself matches: the feature stays one
    const both = partitionElements([lot, space], {
        subFilters: [{ key: 'amenity', op: 'exists' }],
        mainFilters: LOT_FILTERS
    });
    assert.deepEqual(both.main.map(e => e.id), [1]);
    assert.deepEqual(both.sub.map(e => e.id), [2]);

    // Without main filters (a raw query), anything matching is a sub-feature
    const raw = partitionElements([lot, space], { subFilters: [{ key: 'amenity', op: 'exists' }] });
    assert.deepEqual(raw.main, []);
    assert.deepEqual(raw.sub.map(e => e.id), [1, 2]);
});

test('no sub-feature filters means nothing is a sub-feature', () => {
    const elements = [rect(1, { amenity: 'parking' }, [0, 0, 1, 1])];

    assert.deepEqual(partitionElements(elements, { subFilters: null }), { main: elements, sub: [] });
    assert.deepEqual(partitionElements(elements, {}), { main: elements, sub: [] });
    assert.deepEqual(partitionElements(null, { subFilters: SPACE_FILTERS }), { main: [], sub: [] });
});

test('a point is inside a polygon, and inside a multipolygon unless it is in a hole', () => {
    const square = { type: 'Polygon', coordinates: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] };
    assert.equal(isPointInGeometry([5, 5], square), true);
    assert.equal(isPointInGeometry([15, 5], square), false);

    const donut = {
        type: 'MultiPolygon',
        coordinates: [[
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
        ]]
    };
    assert.equal(isPointInGeometry([2, 2], donut), true);
    assert.equal(isPointInGeometry([5, 5], donut), false, 'an island is not in the lake');
    assert.equal(isPointInGeometry([5, 5], { type: 'LineString', coordinates: [[0, 0], [1, 1]] }), false);
});

test('sub-features are attached to every feature that encloses them', () => {
    const elements = [
        rect(1, { amenity: 'parking', name: 'Big' }, [0, 0, 100, 100]),
        rect(2, { amenity: 'parking', name: 'Nested' }, [10, 10, 30, 30]),
        rect(3, { amenity: 'parking', name: 'Elsewhere' }, [200, 200, 300, 300]),
        line(4, { highway: 'service' }, [[0, 150], [10, 150]]) // an open way: no interior
    ];
    const subs = [
        rect(11, { amenity: 'parking_space' }, [12, 12, 14, 14]),   // in Big and Nested
        rect(12, { amenity: 'parking_space' }, [50, 50, 52, 52]),   // in Big only
        rect(13, { amenity: 'parking_space' }, [400, 400, 402, 402]), // in nothing
        line(14, { highway: 'service', service: 'parking_aisle' }, [[60, 60], [70, 70]]) // in Big
    ];

    const { geometries } = parseElements(elements);
    const subParsed = parseElements(subs, { coalesce: false });
    const result = attachSubFeatures(geometries, subParsed.geometries);

    assert.deepEqual(result, { attached: 3, orphans: 1 });

    const byName = Object.fromEntries(geometries.map(g => [g.tags.name, g]));
    assert.deepEqual(byName.Big.subFeatures.map(s => s.id).sort(), [11, 12, 14]);
    assert.deepEqual(byName.Nested.subFeatures.map(s => s.id), [11]);
    assert.deepEqual(byName.Elsewhere.subFeatures, []);

    // The open way has no interior, so nothing could be inside it
    const aisle = geometries.find(g => g.tags.highway === 'service');
    assert.equal(aisle.subFeatures, undefined);
});

test('the grid index does not lose a sub-feature on a cell edge', () => {
    // Many features, so the index has many cells, and a sub-feature placed
    // exactly where cells meet
    const elements = [];
    for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 10;
        const y = Math.floor(i / 10) * 10;
        elements.push(rect(i + 1, { amenity: 'parking' }, [x, y, x + 10, y + 10]));
    }
    const subs = [
        rect(1001, { amenity: 'parking_space' }, [49.5, 49.5, 50.5, 50.5]), // centre on a corner
        rect(1002, { amenity: 'parking_space' }, [33, 33, 34, 34])
    ];

    const { geometries } = parseElements(elements);
    const result = attachSubFeatures(geometries, parseElements(subs, { coalesce: false }).geometries);

    assert.equal(result.orphans, 0);
    const homes = geometries.filter(g => g.subFeatures.some(s => s.id === 1002));
    assert.equal(homes.length, 1);
    assert.equal(homes[0].id, 34); // column 3, row 3
});

test('the parser can leave open ways unstitched', () => {
    const ways = [
        line(1, { highway: 'service' }, [[0, 0], [1, 0]]),
        line(2, { highway: 'service' }, [[1, 0], [2, 0]])
    ];

    const stitched = parseElements(ways);
    assert.equal(stitched.geometries.length, 1);
    assert.equal(stitched.geometries[0].type, 'component');

    const loose = parseElements(ways, { coalesce: false });
    assert.deepEqual(loose.geometries.map(g => [g.id, g.type, g.geometry.type]), [
        [1, 'way', 'LineString'],
        [2, 'way', 'LineString']
    ]);
});
