/**
 * overpassClient.test.js
 * Tests for tidying a custom Overpass server URL before it is used.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normaliseOverpassUrl, DEFAULT_OVERPASS_URL } from '../docs/js/overpassClient.js';

test('adds /interpreter to an /api URL that leaves it off', () => {
    assert.equal(
        normaliseOverpassUrl('https://overpass.example.invalid/api'),
        'https://overpass.example.invalid/api/interpreter'
    );
});

test('adds /interpreter after a trailing slash without doubling it', () => {
    assert.equal(
        normaliseOverpassUrl('https://overpass.example.invalid/api/'),
        'https://overpass.example.invalid/api/interpreter'
    );
    assert.equal(
        normaliseOverpassUrl('https://overpass.example.invalid/api//'),
        'https://overpass.example.invalid/api/interpreter'
    );
});

test('adds /api/interpreter to a bare host', () => {
    assert.equal(
        normaliseOverpassUrl('http://localhost:12345'),
        'http://localhost:12345/api/interpreter'
    );
    assert.equal(
        normaliseOverpassUrl('https://overpass.example.invalid/'),
        'https://overpass.example.invalid/api/interpreter'
    );
});

test('finishes a URL with an API key in its path', () => {
    const keyed = 'https://overpass.example.invalid/k/fm_comm_TESTKEY';
    assert.equal(normaliseOverpassUrl(keyed + '/api/'), keyed + '/api/interpreter');
    assert.equal(normaliseOverpassUrl(keyed + '/api'), keyed + '/api/interpreter');
    assert.equal(normaliseOverpassUrl(keyed + '/'), keyed + '/api/interpreter');
    assert.equal(normaliseOverpassUrl(keyed), keyed + '/api/interpreter');
    assert.equal(normaliseOverpassUrl(keyed + '/api/interpreter'), keyed + '/api/interpreter');
});

test('adds /api/interpreter to a server under a path of its own', () => {
    assert.equal(
        normaliseOverpassUrl('https://maps.example.invalid/osm/tools/overpass'),
        'https://maps.example.invalid/osm/tools/overpass/api/interpreter'
    );
});

test('keeps a query string where it belongs', () => {
    assert.equal(
        normaliseOverpassUrl('https://overpass.example.invalid/api?key=abc'),
        'https://overpass.example.invalid/api/interpreter?key=abc'
    );
});

test('leaves a URL that already ends in /interpreter as typed', () => {
    assert.equal(normaliseOverpassUrl(DEFAULT_OVERPASS_URL), DEFAULT_OVERPASS_URL);
    assert.equal(
        normaliseOverpassUrl('https://overpass.example.invalid/api/interpreter/'),
        'https://overpass.example.invalid/api/interpreter/'
    );
});

test('trims surrounding whitespace', () => {
    assert.equal(
        normaliseOverpassUrl('  https://overpass.example.invalid/api/interpreter  '),
        'https://overpass.example.invalid/api/interpreter'
    );
});

test('leaves empty and unparseable input alone', () => {
    assert.equal(normaliseOverpassUrl(''), '');
    assert.equal(normaliseOverpassUrl('   '), '');
    assert.equal(normaliseOverpassUrl(undefined), '');
    assert.equal(normaliseOverpassUrl('not a url'), 'not a url');
    assert.equal(normaliseOverpassUrl('ftp://example.invalid/api'), 'ftp://example.invalid/api');
});
