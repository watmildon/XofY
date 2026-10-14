/**
 * tagMatcher.test.js
 * Tests for matching a tag list against parsed filters, the way Overpass
 * would, so that a fetched result can be sorted into features and
 * sub-features.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesFilter, matchesFilters } from '../docs/js/search/tagMatcher.js';
import { parseTagExpression } from '../docs/js/search/tagParser.js';

const SPACE = { amenity: 'parking_space', capacity: '1' };
const LOT = { amenity: 'parking', name: 'Lot A', parking: 'surface' };

test('equality and inequality', () => {
    assert.equal(matchesFilter(SPACE, { key: 'amenity', op: '=', value: 'parking_space' }), true);
    assert.equal(matchesFilter(LOT, { key: 'amenity', op: '=', value: 'parking_space' }), false);
    assert.equal(matchesFilter(LOT, { key: 'amenity', op: '!=', value: 'parking_space' }), true);
    // Overpass [k!=v] also matches elements without k at all
    assert.equal(matchesFilter(SPACE, { key: 'name', op: '!=', value: 'x' }), true);
});

test('presence and absence', () => {
    assert.equal(matchesFilter(LOT, { key: 'name', op: 'exists' }), true);
    assert.equal(matchesFilter(SPACE, { key: 'name', op: 'exists' }), false);
    assert.equal(matchesFilter(SPACE, { key: 'name', op: 'missing' }), true);
    assert.equal(matchesFilter(LOT, { key: 'name', op: 'missing' }), false);
});

test('regex filters, and an unreadable pattern matches nothing', () => {
    assert.equal(matchesFilter(SPACE, { key: 'amenity', op: '~', value: '^parking' }), true);
    assert.equal(matchesFilter(LOT, { key: 'amenity', op: '~', value: 'space$' }), false);
    assert.equal(matchesFilter(LOT, { key: 'amenity', op: '!~', value: 'space$' }), true);
    // No k, no match - but [k!~v] on an element without k is true
    assert.equal(matchesFilter(SPACE, { key: 'name', op: '!~', value: '.' }), true);
    assert.equal(matchesFilter(SPACE, { key: 'amenity', op: '~', value: '(' }), false);
});

test('every filter has to hold, and an empty list describes nothing', () => {
    const filters = parseTagExpression('amenity=parking name=*').filters;

    assert.equal(matchesFilters(LOT, filters), true);
    assert.equal(matchesFilters(SPACE, filters), false);
    assert.equal(matchesFilters(LOT, []), false);
    assert.equal(matchesFilters(null, filters), false);
    assert.equal(matchesFilters(undefined, []), false);
});

test('values are compared as text, whatever the tag list holds', () => {
    assert.equal(matchesFilter({ capacity: 1 }, { key: 'capacity', op: '=', value: '1' }), true);
    assert.equal(matchesFilter({ capacity: '' }, { key: 'capacity', op: 'exists' }), true);
});
