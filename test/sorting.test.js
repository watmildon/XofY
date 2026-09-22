/**
 * sorting.test.js
 * Tests for the grid's sort orders.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { sortGeometries } from '../docs/js/utils/sorting.js';

function geom(name, nodeCount, width, height) {
    return { name, nodeCount, bounds: { width, height } };
}

const input = [
    geom('wide', 3, 10, 1),      // area 10
    geom('big', 8, 5, 5),        // area 25
    geom('vertical', 2, 0, 4),   // degenerate: counts as 4
    geom('tiny', 5, 1, 1)        // area 1
];

const names = list => list.map(g => g.name);

test('default returns a copy in the original order', () => {
    const sorted = sortGeometries(input, 'default');
    assert.deepEqual(names(sorted), ['wide', 'big', 'vertical', 'tiny']);
    assert.notEqual(sorted, input);
});

test('sorts by node count in both directions', () => {
    assert.deepEqual(names(sortGeometries(input, 'nodes-asc')), ['vertical', 'wide', 'tiny', 'big']);
    assert.deepEqual(names(sortGeometries(input, 'nodes-desc')), ['big', 'tiny', 'wide', 'vertical']);
});

test('sorts by size, treating a zero-width shape by its other dimension', () => {
    assert.deepEqual(names(sortGeometries(input, 'size-asc')), ['tiny', 'vertical', 'wide', 'big']);
    assert.deepEqual(names(sortGeometries(input, 'size-desc')), ['big', 'wide', 'vertical', 'tiny']);
});

test('a missing node count sorts as zero', () => {
    const sorted = sortGeometries([geom('a', 4, 1, 1), { name: 'none', bounds: {} }], 'nodes-asc');
    assert.deepEqual(names(sorted), ['none', 'a']);
});

test('an unknown sort order leaves the list as it is', () => {
    assert.deepEqual(names(sortGeometries(input, 'colour')), names(input));
});

test('never mutates the input', () => {
    const before = names(input);
    sortGeometries(input, 'nodes-asc');
    sortGeometries(input, 'size-desc');
    assert.deepEqual(names(input), before);
});
