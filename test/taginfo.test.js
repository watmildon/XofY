/**
 * taginfo.test.js
 * Tests for the tag suggestion helpers, against captured taginfo responses.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    formatCount,
    buildKeysUrl,
    buildValuesUrl,
    mapKeys,
    mapValues,
    cacheKeyFor,
    peekSuggestions,
    requestSuggestions,
    resetTaginfoState,
    MAX_SUGGESTIONS
} from '../docs/js/search/taginfo.js';
import { getTypingContext } from '../docs/js/search/tagParser.js';

/**
 * Load a captured response
 * @param {string} name - File name in test/data
 * @returns {Object} Parsed JSON
 */
function fixture(name) {
    return JSON.parse(readFileSync(fileURLToPath(new URL(`./data/${name}`, import.meta.url)), 'utf8'));
}

const KEYS = fixture('taginfo-keys-leis.json');
const VALUES = fixture('taginfo-values-leisure-swi.json');

test('formats counts compactly', () => {
    assert.equal(formatCount(3048651), '3.0M');
    assert.equal(formatCount(157495), '157k');
    assert.equal(formatCount(942), '942');
    assert.equal(formatCount(1500), '1.5k');
    assert.equal(formatCount(11831350), '11.8M');
    assert.equal(formatCount(0), '0');
    assert.equal(formatCount(-1), '');
    assert.equal(formatCount(undefined), '');
    assert.equal(formatCount('nonsense'), '');
});

test('builds the documented taginfo URLs', () => {
    const keys = new URL(buildKeysUrl('leis'));
    assert.equal(keys.origin + keys.pathname, 'https://taginfo.openstreetmap.org/api/4/keys/all');
    assert.equal(keys.searchParams.get('query'), 'leis');
    assert.equal(keys.searchParams.get('sortname'), 'count_all');
    assert.equal(keys.searchParams.get('sortorder'), 'desc');
    assert.equal(keys.searchParams.get('rp'), String(MAX_SUGGESTIONS));
    // Without a page, taginfo ignores rp (and answers 412 on key/values)
    assert.equal(keys.searchParams.get('page'), '1');
    assert.equal(keys.searchParams.get('filter'), 'in_wiki');

    const values = new URL(buildValuesUrl('leisure', 'swi'));
    assert.equal(values.origin + values.pathname, 'https://taginfo.openstreetmap.org/api/4/key/values');
    assert.equal(values.searchParams.get('key'), 'leisure');
    assert.equal(values.searchParams.get('query'), 'swi');
    assert.equal(values.searchParams.get('sortname'), 'count');
    assert.equal(values.searchParams.get('sortorder'), 'desc');
    assert.equal(values.searchParams.get('rp'), String(MAX_SUGGESTIONS));
    assert.equal(values.searchParams.get('page'), '1');
});

test('reads keys from a captured response, most used first', () => {
    const keys = mapKeys(KEYS);

    assert.deepEqual(keys[0], { key: 'leisure', count: 11831350 });
    assert.ok(keys.every((row, i) => i === 0 || row.count <= keys[i - 1].count));
    // Keys nobody uses are not worth suggesting
    assert.ok(!keys.some(row => row.count === 0));
    assert.ok(!keys.some(row => row.key === 'not_accepted_import:leisure'));
});

test('reads values from a captured response and caps the list', () => {
    const values = mapValues(VALUES, 'leisure');

    assert.equal(values.length, MAX_SUGGESTIONS, 'the response is longer than we want to show');
    assert.deepEqual(values[0], { key: 'leisure', value: 'swimming_pool', count: 3048651 });
    assert.equal(values[1].value, 'swimming_area');
    assert.ok(values.every(row => row.key === 'leisure'));
    assert.ok(values.every((row, i) => i === 0 || row.count <= values[i - 1].count));
});

test('copes with junk responses', () => {
    assert.deepEqual(mapKeys(null), []);
    assert.deepEqual(mapKeys({}), []);
    assert.deepEqual(mapKeys({ data: 'nope' }), []);
    assert.deepEqual(mapValues({ data: [{}] }, 'leisure'), []);
});

test('derives a cache key from what is being typed', () => {
    assert.equal(cacheKeyFor(getTypingContext('leis')), 'key:leis');
    assert.equal(cacheKeyFor(getTypingContext('leisure=swi')), 'value:leisure:swi');
    assert.equal(cacheKeyFor(getTypingContext('leisure=')), 'value:leisure:');
    // An empty key fragment would ask for every key there is
    assert.equal(cacheKeyFor(getTypingContext('')), null);
    assert.equal(cacheKeyFor(null), null);
});

test('looks up keys once, then answers from memory', async () => {
    resetTaginfoState();
    let calls = 0;
    const fetchImpl = async (url) => {
        calls++;
        assert.match(url, /keys\/all/);
        return { ok: true, json: async () => KEYS };
    };

    const context = getTypingContext('leis');
    assert.equal(peekSuggestions(context), undefined, 'nothing is known before the first lookup');

    const rows = await requestSuggestions(context, { fetchImpl, debounceMs: 0 });
    assert.equal(rows[0].key, 'leisure');
    assert.equal(calls, 1);

    // The cache is what the suggestion list reads synchronously
    assert.equal(peekSuggestions(context)[0].key, 'leisure');
    await requestSuggestions(context, { fetchImpl, debounceMs: 0 });
    assert.equal(calls, 1, 'a cached context must not be looked up again');
});

test('a newer keystroke supersedes the one before it', async () => {
    resetTaginfoState();
    let calls = 0;
    const fetchImpl = async (url) => {
        calls++;
        return { ok: true, json: async () => (url.includes('key/values') ? VALUES : KEYS) };
    };

    const stale = requestSuggestions(getTypingContext('leis'), { fetchImpl, debounceMs: 5 });
    const fresh = requestSuggestions(getTypingContext('leisure=swi'), { fetchImpl, debounceMs: 5 });

    assert.deepEqual(await stale, [], 'the superseded lookup resolves empty');
    assert.equal((await fresh)[0].value, 'swimming_pool');
    assert.equal(calls, 1, 'only the newest context is fetched');
});

test('a taginfo failure costs nothing', async () => {
    resetTaginfoState();

    // The module warns about these on purpose; the test need not print them
    const warn = console.warn;
    console.warn = () => {};

    const failing = await requestSuggestions(getTypingContext('leis'), {
        fetchImpl: async () => ({ ok: false, status: 503 }),
        debounceMs: 0
    });
    assert.deepEqual(failing, [], 'an error becomes "no Tags group", not an exception');

    resetTaginfoState();
    const offline = await requestSuggestions(getTypingContext('leis'), {
        fetchImpl: async () => { throw new TypeError('network down'); },
        debounceMs: 0
    });
    assert.deepEqual(offline, []);

    // Nothing to look up is not an error either
    assert.deepEqual(await requestSuggestions(getTypingContext(''), { debounceMs: 0 }), []);

    console.warn = warn;
});

test('the cache does not grow without bound', async () => {
    resetTaginfoState();
    const fetchImpl = async () => ({ ok: true, json: async () => KEYS });
    const contextFor = (partial) => getTypingContext(partial);

    // More lookups than the cache is willing to keep
    for (let i = 0; i < 120; i++) {
        await requestSuggestions(contextFor(`key${i}`), { fetchImpl, debounceMs: 0 });
    }

    // 120 lookups, 100 kept: the first 20 are gone, the rest survive
    assert.equal(peekSuggestions(contextFor('key0')), undefined, 'the oldest lookup is evicted');
    assert.equal(peekSuggestions(contextFor('key19')), undefined);
    assert.ok(peekSuggestions(contextFor('key20')), 'the rest of the window survives');
    assert.ok(peekSuggestions(contextFor('key119')), 'the newest is kept');
});

test('value rows starting with what was typed come first', () => {
    // taginfo matches anywhere in the value, so `building=c` comes back with
    // "detached" (high count) mixed in among the ones that start with c
    const payload = {
        data: [
            { value: 'detached', count: 9_000_000 },
            { value: 'church', count: 400_000 },
            { value: 'commercial', count: 1_500_000 },
            { value: 'semidetached_house', count: 800_000 },
            { value: 'construction', count: 100_000 }
        ]
    };

    assert.deepEqual(
        mapValues(payload, 'building', 'c').map(row => row.value),
        ['commercial', 'church', 'construction', 'detached', 'semidetached_house']
    );

    // With nothing typed it is simply the most used first
    assert.deepEqual(
        mapValues(payload, 'building', '').map(row => row.value).slice(0, 2),
        ['detached', 'commercial']
    );
});
