/**
 * queryBuilder.test.js
 * Tests for Overpass QL generation and escaping.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    escapeQLString,
    formatFilter,
    formatFilters,
    buildOverpassQuery,
    buildGeomQuery,
    buildCountQuery,
    DEFAULT_TIMEOUT
} from '../docs/js/search/queryBuilder.js';
import { isSupportedElementTypes } from '../docs/js/search/queryBuilder.js';
import { parseTagExpression } from '../docs/js/search/tagParser.js';

const NICE = { osmType: 'relation', osmId: 170100 };

test('escapes QL string literals', () => {
    assert.equal(escapeQLString('plain'), 'plain');
    assert.equal(escapeQLString('say "hi"'), 'say \\"hi\\"');
    assert.equal(escapeQLString('back\\slash'), 'back\\\\slash');
    assert.equal(escapeQLString('line\nbreak'), 'line\\nbreak');
    assert.equal(escapeQLString('tab\there'), 'tab\\there');
    assert.equal(escapeQLString('carriage\rreturn'), 'carriage\\rreturn');
    // Brackets are safe inside a quoted literal and stay as typed
    assert.equal(escapeQLString('a]b[c'), 'a]b[c');
    assert.equal(escapeQLString('都営地下鉄'), '都営地下鉄');
    assert.equal(escapeQLString(''), '');
    assert.equal(escapeQLString(undefined), '');
});

test('a typed quote cannot break out of the literal', () => {
    const { filters } = parseTagExpression('name="a\\"];out;//"');
    assert.deepEqual(filters, [{ key: 'name', op: '=', value: 'a"];out;//' }]);
    assert.equal(formatFilters(filters), '["name"="a\\"];out;//"]');
});

test('formats each filter operator', () => {
    assert.equal(formatFilter({ key: 'leisure', op: '=', value: 'park' }), '["leisure"="park"]');
    assert.equal(formatFilter({ key: 'name', op: 'exists' }), '["name"]');
    assert.equal(formatFilter({ key: 'athletics', op: 'missing' }), '[!"athletics"]');
    assert.equal(formatFilter({ key: 'amenity', op: '!=', value: 'bar' }), '["amenity"!="bar"]');
    assert.equal(formatFilter({ key: 'name', op: '~', value: '^A' }), '["name"~"^A"]');
    assert.equal(formatFilter({ key: 'name', op: '!~', value: '^A' }), '["name"!~"^A"]');
});

test('rejects broken filters', () => {
    assert.throws(() => formatFilter({ op: '=', value: 'x' }), /missing a key/);
    assert.throws(() => formatFilter({ key: 'a', op: '<' }), /Unsupported tag filter operator/);
});

test('concatenates several filters', () => {
    const { filters } = parseTagExpression('leisure=swimming_pool name !fee');
    assert.equal(formatFilters(filters), '["leisure"="swimming_pool"]["name"][!"fee"]');
});

test('builds an area query', () => {
    const { filters } = parseTagExpression('leisure=swimming_pool');
    assert.equal(
        buildOverpassQuery({ filters, area: NICE }),
        `[out:json][timeout:60];
rel(170100);
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out geom;`
    );
});

test('builds a query for a way area', () => {
    const { filters } = parseTagExpression('building');
    assert.equal(
        buildOverpassQuery({ filters, area: { osmType: 'way', osmId: 42 }, elementTypes: 'way' }),
        `[out:json][timeout:60];
way(42);
map_to_area->.searchArea;
way(area.searchArea)["building"];
out geom;`
    );
});

test('builds a world query when there is no area', () => {
    const { filters } = parseTagExpression('attraction=water_slide');
    const expected = `[out:json][timeout:60];
wr["attraction"="water_slide"];
out geom;`;

    assert.equal(buildOverpassQuery({ filters }), expected);
    assert.equal(buildOverpassQuery({ filters, area: null }), expected);
    assert.equal(buildOverpassQuery({ filters, area: { osmType: 'relation', osmId: null } }), expected);
});

test('builds the count variant', () => {
    const { filters } = parseTagExpression('leisure=swimming_pool');
    assert.equal(
        buildCountQuery({ filters, area: NICE }),
        `[out:json][timeout:60];
rel(170100);
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out count;`
    );
    assert.equal(buildGeomQuery({ filters, area: NICE }), buildOverpassQuery({ filters, area: NICE }));
});

test('honours the timeout setting', () => {
    const { filters } = parseTagExpression('leisure=park');
    assert.equal(DEFAULT_TIMEOUT, 60);
    assert.match(buildOverpassQuery({ filters }), /^\[out:json\]\[timeout:60\];/);
    assert.match(buildOverpassQuery({ filters, timeout: 180 }), /^\[out:json\]\[timeout:180\];/);
    assert.match(buildOverpassQuery({ filters, timeout: null }), /^\[out:json\];/);
    assert.throws(() => buildOverpassQuery({ filters, timeout: 0 }), /Invalid timeout/);
    assert.throws(() => buildOverpassQuery({ filters, timeout: 1.5 }), /Invalid timeout/);
    assert.throws(() => buildOverpassQuery({ filters, timeout: '60; out;' }), /Invalid timeout/);
});

test('refuses ids and options that could smuggle in QL', () => {
    const filters = [{ key: 'leisure', op: '=', value: 'park' }];
    assert.throws(() => buildOverpassQuery({ filters, area: { osmType: 'relation', osmId: '1);out;//' } }), /Invalid OSM id/);
    assert.throws(() => buildOverpassQuery({ filters, area: { osmType: 'relation', osmId: -3 } }), /Invalid OSM id/);
    assert.throws(() => buildOverpassQuery({ filters, area: { osmType: 'relation', osmId: 1.5 } }), /Invalid OSM id/);
    assert.throws(() => buildOverpassQuery({ filters, area: { osmType: 'node', osmId: 5 } }), /Unsupported OSM area type/);
    assert.throws(() => buildOverpassQuery({ filters, elementTypes: 'wr;out;' }), /Unsupported element types/);
    assert.throws(() => buildOverpassQuery({ filters, output: 'meta' }), /Unsupported output mode/);
});

test('exposes the element type whitelist it enforces', () => {
    assert.ok(isSupportedElementTypes('wr'));
    assert.ok(isSupportedElementTypes('way'));
    assert.ok(isSupportedElementTypes('rel'));
    assert.ok(!isSupportedElementTypes('wr;out;'));
    assert.ok(!isSupportedElementTypes(''));
    assert.ok(!isSupportedElementTypes(undefined));
});

test('accepts the OSM type spellings Nominatim uses', () => {
    const filters = [{ key: 'leisure', op: '=', value: 'park' }];
    const asRelation = buildOverpassQuery({ filters, area: { osmType: 'relation', osmId: 7444 } });
    assert.equal(buildOverpassQuery({ filters, area: { osmType: 'rel', osmId: 7444 } }), asRelation);
    assert.equal(buildOverpassQuery({ filters, area: { osmType: 'R', osmId: 7444 } }), asRelation);
    assert.match(buildOverpassQuery({ filters, area: { osmType: 'w', osmId: 7444 } }), /^way\(7444\);$/m);
});

test('accepts a ready-made QL tag expression (used by curated features)', () => {
    assert.equal(
        buildOverpassQuery({
            rawTagExpression: '[leisure=track][!athletics]',
            elementTypes: 'wr',
            area: { osmType: 'relation', osmId: 237385 },
            timeout: null
        }),
        `[out:json];
rel(237385);
map_to_area->.searchArea;
wr(area.searchArea)[leisure=track][!athletics];
out geom;`
    );

    // The old name must not quietly keep working
    assert.equal(
        buildOverpassQuery({ tagExpression: '[leisure=track]', filters: [] }),
        `[out:json][timeout:60];
wr;
out geom;`
    );
});
