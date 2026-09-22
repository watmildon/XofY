/**
 * presets.test.js
 * Tests for the preset matcher, the lazy loader, and the generated preset file.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    matchPresets,
    presetToFilters,
    presetTagSummary,
    elementTypesForGeometry,
    singularise,
    loadPresets,
    peekPresets,
    resetPresetCache,
    DEFAULT_PRESETS_URL
} from '../docs/js/search/presets.js';
import { formatFilters } from '../docs/js/search/queryBuilder.js';

const PRESETS_PATH = fileURLToPath(new URL('../docs/data/presets.json', import.meta.url));

const SAMPLE = [
    { id: 'leisure/swimming_pool', name: 'Swimming Pool', tags: { leisure: 'swimming_pool' }, elementTypes: 'wr', count: 3048651, terms: ['aquatics', 'dive', 'water'] },
    { id: 'leisure/swimming_area', name: 'Natural Swimming Area', tags: { leisure: 'swimming_area' }, elementTypes: 'wr', count: 3000, terms: ['swimming pool'] },
    { id: 'amenity/pool_hall', name: 'Pool Hall', tags: { amenity: 'pool_hall' }, elementTypes: 'wr', count: 1200, terms: ['billiards'] },
    { id: 'leisure/pool', name: 'Pool', tags: { leisure: 'pool' }, elementTypes: 'wr', count: 900 },
    { id: 'building/carpool', name: 'Carpool Building', tags: { building: 'carpool' }, elementTypes: 'wr', count: 40 },
    { id: 'shop/pool_supplies', name: 'Pool Supply Shop', tags: { shop: 'pool_supplies' }, elementTypes: 'wr', count: 4172, terms: ['pool'] },
    { id: 'hidden/thing', name: 'Hidden Thing', tags: { hidden: 'thing' }, elementTypes: 'wr', count: 10, searchable: false }
];

/**
 * Match and return ids, for readable assertions
 * @param {string} query - Text to match
 * @param {Object} [options] - Options for matchPresets
 * @returns {Array<string>} Matching preset ids in rank order
 */
function ids(query, options) {
    return matchPresets(SAMPLE, query, options).map(preset => preset.id);
}

test('ranks by match tier, then by how much the tag is used', () => {
    assert.deepEqual(ids('pool'), [
        'leisure/pool',           // tier 0: exact name
        // tier 1: starts the name or one of its words, most used first
        'leisure/swimming_pool',  //   "Swimming Pool", 3,048,651
        'shop/pool_supplies',     //   "Pool Supply Shop", 4,172
        'amenity/pool_hall',      //   "Pool Hall", 1,200
        'building/carpool',       // tier 2: name substring
        'leisure/swimming_area'   // tier 3: term match
    ]);
});

test('treats starting the name and starting a word as one tier', () => {
    // Without that, "Pool Supply Shop" would outrank "Swimming Pool" on a
    // spelling technicality even though nobody is looking for the shop
    const [best] = ids('pool');
    assert.notEqual(best, 'shop/pool_supplies');
    assert.ok(ids('pool').indexOf('leisure/swimming_pool') < ids('pool').indexOf('shop/pool_supplies'));
});

test('falls back to the shorter name when counts tie', () => {
    const tied = [
        { id: 'a', name: 'Pool House', tags: { a: 'b' }, count: 5 },
        { id: 'b', name: 'Pool', tags: { c: 'd' }, count: 5 }
    ];
    assert.deepEqual(matchPresets(tied, 'pool').map(p => p.id), ['b', 'a']);
});

test('matches names case-insensitively and ignores extra whitespace', () => {
    assert.deepEqual(ids('  SWIMMING   pool  '), ['leisure/swimming_pool', 'leisure/swimming_area']);
});

test('matches search terms when the name does not match', () => {
    assert.deepEqual(ids('billiards'), ['amenity/pool_hall']);
    assert.deepEqual(ids('aquatics'), ['leisure/swimming_pool']);
});

test('keeps presets iD marks as not searchable', () => {
    // iD hides these to steer mappers, but this app searches existing data
    assert.deepEqual(ids('hidden'), ['hidden/thing']);
});

test('summarises tags so rows sharing a name can be told apart', () => {
    assert.equal(presetTagSummary(SAMPLE[0]), 'leisure=swimming_pool');
    assert.equal(presetTagSummary({ tags: { building: '*' } }), 'building=*');
    assert.equal(presetTagSummary({ tags: { amenity: 'bar', lgbtq: 'primary' } }), 'amenity=bar lgbtq=primary');
    assert.equal(presetTagSummary({}), '');
    assert.equal(presetTagSummary(null), '');
});

test('returns nothing for an empty query', () => {
    assert.deepEqual(ids(''), []);
    assert.deepEqual(ids('   '), []);
    assert.deepEqual(ids(null), []);
    assert.deepEqual(matchPresets(null, 'pool'), []);
});

test('honours the result limit', () => {
    assert.equal(ids('pool', { limit: 2 }).length, 2);
    assert.equal(ids('pool', { limit: Infinity }).length, 6);
});

test('records with no count still match, they just sort last in their tier', () => {
    const mixed = [
        { id: 'counted', name: 'Park Bench', tags: { a: 'b' }, count: 10 },
        { id: 'uncounted', name: 'Park Area', tags: { c: 'd' } }
    ];
    assert.deepEqual(matchPresets(mixed, 'park').map(p => p.id), ['counted', 'uncounted']);
});

test('converts preset tags into filters', () => {
    assert.deepEqual(presetToFilters(SAMPLE[0]), [
        { key: 'leisure', op: '=', value: 'swimming_pool' }
    ]);

    // A `*` value means the key simply has to exist
    assert.deepEqual(presetToFilters({ tags: { building: '*', 'building:levels': '3' } }), [
        { key: 'building', op: 'exists' },
        { key: 'building:levels', op: '=', value: '3' }
    ]);

    assert.deepEqual(presetToFilters({}), []);
    assert.deepEqual(presetToFilters(null), []);
});

test('derives element types from preset geometry', () => {
    assert.equal(elementTypesForGeometry(['line']), 'way');
    assert.equal(elementTypesForGeometry(['point', 'line']), 'way');
    assert.equal(elementTypesForGeometry(['area']), 'wr');
    assert.equal(elementTypesForGeometry(['line', 'area']), 'wr');
    assert.equal(elementTypesForGeometry(['relation']), 'wr');
    assert.equal(elementTypesForGeometry(undefined), 'wr');
});

test('does not fetch anything at import time, and fetches once when asked', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;

    globalThis.fetch = async (url) => {
        calls++;
        assert.equal(url, 'data/presets.json');
        return { ok: true, json: async () => [{ id: 'x', name: 'X', tags: {} }] };
    };

    try {
        // A fresh copy of the module: importing it must not touch the network
        const fresh = await import('../docs/js/search/presets.js?no-fetch-on-import');
        assert.equal(calls, 0);
        assert.equal(fresh.DEFAULT_PRESETS_URL, DEFAULT_PRESETS_URL);

        fresh.resetPresetCache();
        const first = await fresh.loadPresets();
        const second = await fresh.loadPresets();

        assert.equal(calls, 1, 'the preset file should only be fetched once');
        assert.equal(first, second);
        assert.deepEqual(first.map(preset => preset.id), ['x']);
    } finally {
        globalThis.fetch = originalFetch;
        resetPresetCache();
    }
});

test('a failed load backs off instead of retrying on every keystroke', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;

    globalThis.fetch = async () => {
        calls++;
        return calls === 1
            ? { ok: false, status: 404 }
            : { ok: true, json: async () => [] };
    };

    try {
        resetPresetCache();
        await assert.rejects(() => loadPresets(), /Failed to load presets: 404/);

        // Typing on does not hammer the server
        await assert.rejects(() => loadPresets(), /Failed to load presets: 404/);
        await assert.rejects(() => loadPresets(), /Failed to load presets: 404/);
        assert.equal(calls, 1, 'still just the one attempt');

        // Once the cooldown is over (or the page is reloaded) it tries again
        resetPresetCache();
        assert.deepEqual(await loadPresets(), []);
        assert.equal(calls, 2);
    } finally {
        globalThis.fetch = originalFetch;
        resetPresetCache();
    }
});

test('the generated preset file is usable', () => {
    const presets = JSON.parse(readFileSync(PRESETS_PATH, 'utf8'));

    assert.ok(Array.isArray(presets));
    assert.ok(presets.length > 500, `expected a sizeable preset list, got ${presets.length}`);

    for (const preset of presets) {
        const where = preset.name || JSON.stringify(preset.tags);

        assert.ok(preset.name, `a preset has no name: ${where}`);
        assert.ok(Object.keys(preset.tags || {}).length > 0, `${where} has no tags`);
        assert.ok(['wr', 'way'].includes(preset.elementTypes), `${where} has odd element types`);
        // Keys must be literal: iD's `addr:*` style key patterns cannot be queried
        assert.ok(Object.keys(preset.tags).every(key => !key.includes('*')), `${where} has a wildcard key`);
        // Every record carries a usage count, and only multi-tag ones are approximate
        assert.ok(Number.isInteger(preset.count) && preset.count >= 0, `${where} has no usable count`);
        assert.equal(
            Boolean(preset.approx),
            Object.keys(preset.tags).length > 1,
            `${where} is flagged approximate inconsistently`
        );
        assert.ok(!('searchable' in preset), `${where} should not carry searchable`);
        // Nothing reads the schema id at runtime, so it is not shipped
        assert.ok(!('id' in preset), `${where} still carries its schema id`);
    }

    const [best] = matchPresets(presets, 'swimming pool', { limit: 1 });
    assert.equal(best.name, 'Swimming Pool');
    assert.equal(best.elementTypes, 'wr');
    assert.equal(formatFilters(presetToFilters(best)), '["leisure"="swimming_pool"]');

    const [road] = matchPresets(presets, 'primary road', { limit: 1 });
    assert.equal(presetTagSummary(road), 'highway=primary');
    assert.equal(road.elementTypes, 'way', 'line-only presets should query ways');
});

test('plurals find the singular feature', () => {
    const presets = JSON.parse(readFileSync(PRESETS_PATH, 'utf8'));
    const top = (query) => matchPresets(presets, query, { limit: 1 }).map(presetTagSummary)[0];

    // The placeholder and the curated names are plural, so people type plurals
    assert.equal(top('castles'), 'historic=castle');
    assert.equal(top('lighthouses'), 'man_made=lighthouse');
    assert.equal(top('golf courses'), 'leisure=golf_course');
    assert.equal(top('swimming pools'), 'leisure=swimming_pool');

    // ...without displacing a direct match
    assert.equal(top('castle'), 'historic=castle');
    assert.equal(top('park'), 'leisure=park');
});

test('the generated presets rank real searches sensibly', () => {
    const presets = JSON.parse(readFileSync(PRESETS_PATH, 'utf8'));
    const top = (query, limit = 5) => matchPresets(presets, query, { limit }).map(presetTagSummary);

    // The whole point of keeping non-searchable presets and baking in counts
    assert.equal(top('school')[0], 'amenity=school');
    assert.ok(top('school').indexOf('amenity=school') < top('school').indexOf('education=school'));

    // "pool" must not be won by the shop that happens to start with the word
    assert.equal(top('pool')[0], 'leisure=swimming_pool');

    assert.equal(top('swimming pool')[0], 'leisure=swimming_pool');
    assert.equal(top('park')[0], 'leisure=park');
    assert.equal(top('stadium')[0], 'leisure=stadium');
    assert.ok(top('church', 8).includes('building=church'));
    assert.ok(top('golf', 8).includes('leisure=golf_course'));
    assert.ok(top('university', 8).includes('amenity=university'));
    assert.ok(top('reservoir', 8).includes('landuse=reservoir'));

    // Presets sharing a display name are distinguishable by their tags
    const schools = matchPresets(presets, 'school', { limit: 3 });
    assert.equal(new Set(schools.map(p => p.name)).size < schools.length, true, 'expected a repeated name');
    assert.equal(new Set(schools.map(presetTagSummary)).size, schools.length);
});

test('singularises simple plurals, and leaves other words alone', () => {
    assert.equal(singularise('castles'), 'castle');
    assert.equal(singularise('golf courses'), 'golf course');
    assert.equal(singularise('libraries'), 'library');
    assert.equal(singularise('churches'), 'church');
    assert.equal(singularise('benches'), 'bench');

    // Not every trailing s is a plural
    assert.equal(singularise('pass'), 'pass');
    assert.equal(singularise('gas'), 'gas');
    assert.equal(singularise('bus'), 'bus');
    assert.equal(singularise('park'), 'park');
    assert.equal(singularise(''), '');
});

test('a plural match ranks below a direct one', () => {
    const sample = [
        { name: 'Castles Museum', tags: { tourism: 'museum' }, count: 10 },
        { name: 'Castle', tags: { historic: 'castle' }, count: 100000 }
    ];

    // "Castles Museum" contains the query as typed, so it wins the tier above
    assert.deepEqual(matchPresets(sample, 'castles').map(p => p.name), ['Castles Museum', 'Castle']);
});

test('the records can be read before the fetch settles', async () => {
    const originalFetch = globalThis.fetch;
    let release;
    const stalled = new Promise(resolve => { release = resolve; });

    globalThis.fetch = () => stalled;

    try {
        resetPresetCache();
        assert.equal(peekPresets(), null, 'nothing to show while the file is on its way');

        const pending = loadPresets();
        assert.equal(peekPresets(), null, 'and still nothing while it hangs');

        release({ ok: true, json: async () => [{ name: 'X', tags: { a: 'b' }, count: 1 }] });
        await pending;

        assert.equal(peekPresets().length, 1, 'available the moment it lands');
    } finally {
        globalThis.fetch = originalFetch;
        resetPresetCache();
    }
});
