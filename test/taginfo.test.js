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
    pickEstimateFilters,
    buildTagStatsUrl,
    readTagCount,
    getTagCount,
    seedTagCount,
    MAX_SUGGESTIONS
} from '../docs/js/search/taginfo.js';
import { getTypingContext } from '../docs/js/search/tagParser.js';
import { parseQlFilters } from '../docs/js/search/qlFilters.js';
import { FEATURES } from '../docs/js/config/features.js';
import { shapeForTagCount, RARE_TAG_THRESHOLD } from '../docs/js/search/queryPlan.js';

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
// How often attraction=water_slide is used, as taginfo answered it. The rarity
// of a tag is what decides which Postpass query shape a search is asked with
const WATER_SLIDE_STATS = fixture('taginfo-tag-stats-water-slide.json');

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

test('the filters sized are the narrowest ones taginfo can count', () => {
    const pools = { key: 'leisure', op: '=', value: 'swimming_pool' };
    const lazyRiver = { key: 'swimming_pool', op: '=', value: 'lazy_river' };
    const name = { key: 'name', op: 'exists' };

    // `=` filters describe fewest objects, so they are the ones worth counting
    assert.deepEqual(pickEstimateFilters([name, pools]), [pools]);
    // All of them, not just the first: a search is as common as its rarest tag
    assert.deepEqual(pickEstimateFilters([pools, lazyRiver, name]), [pools, lazyRiver]);
    assert.deepEqual(pickEstimateFilters([name]), [name]);

    // The others say what a result is not, which says nothing about how many
    assert.deepEqual(pickEstimateFilters([{ key: 'athletics', op: 'missing' }]), []);
    assert.deepEqual(pickEstimateFilters([{ key: 'amenity', op: '!=', value: 'bar' }]), []);
    assert.deepEqual(pickEstimateFilters([{ key: 'name', op: '~', value: '^A' }]), []);
    assert.deepEqual(pickEstimateFilters([]), []);
    assert.deepEqual(pickEstimateFilters(null), []);
    assert.deepEqual(pickEstimateFilters([null, { op: '=', value: 'x' }]), [], 'a filter with no key');
});

test('builds the stats URL taginfo documents', () => {
    // The captured response reports the URL it answered, so the builder is
    // checked against taginfo's own spelling of it
    assert.equal(
        buildTagStatsUrl({ key: 'attraction', op: '=', value: 'water_slide' }),
        WATER_SLIDE_STATS.url
    );

    const key = new URL(buildTagStatsUrl({ key: 'name', op: 'exists' }));
    assert.equal(key.origin + key.pathname, 'https://taginfo.openstreetmap.org/api/4/key/stats');
    assert.equal(key.searchParams.get('key'), 'name');
    assert.equal(key.searchParams.get('value'), null, 'a key on its own has no value');

    // Whatever a key or value holds has to survive being put in a query string
    const odd = new URL(buildTagStatsUrl({ key: 'name:zh', op: '=', value: '都営地下鉄 & co' }));
    assert.equal(odd.searchParams.get('key'), 'name:zh');
    assert.equal(odd.searchParams.get('value'), '都営地下鉄 & co');
});

test('reads the ways-and-relations count out of a stats response', () => {
    // 25,501 ways + 25 relations. The 1,717 nodes are left out: this app never
    // asks either backend for nodes, so they are not part of what is being
    // sized. Either way it is far below the threshold, so a water slide search
    // is asked for with the tag-driven query shape
    assert.equal(readTagCount(WATER_SLIDE_STATS), 25526);
    assert.equal(WATER_SLIDE_STATS.data.find(row => row.type === 'all').count, 27243);

    assert.equal(readTagCount({ data: [{ type: 'ways', count: 25501 }] }), 25501, 'relations may be absent');
    assert.equal(readTagCount({ data: [{ type: 'relations', count: '25' }] }), 25);
    assert.equal(readTagCount({ data: [{ type: 'ways', count: 0 }] }), 0);

    // The 'all' row on its own says nothing about ways and relations
    assert.equal(readTagCount({ data: [{ type: 'all', count: 27243 }] }), null);
    assert.equal(readTagCount({ data: [{ type: 'ways', count: 'lots' }] }), null);
    assert.equal(readTagCount({ data: [] }), null);
    assert.equal(readTagCount({}), null);
    assert.equal(readTagCount(null), null);
});

test('a tag count is looked up once and then remembered', async () => {
    resetTaginfoState();
    const urls = [];
    const fetchImpl = async (url) => {
        urls.push(url);
        return { ok: true, json: async () => WATER_SLIDE_STATS };
    };
    const slides = [{ key: 'attraction', op: '=', value: 'water_slide' }];

    assert.equal(await getTagCount(slides, { fetchImpl }), 25526);
    assert.equal(await getTagCount(slides, { fetchImpl }), 25526);
    assert.deepEqual(urls, [WATER_SLIDE_STATS.url], 'the second search asks nobody');

    // The count belongs to the tag, not to the search it came from
    assert.equal(
        await getTagCount([{ key: 'name', op: 'exists' }, ...slides], { fetchImpl }),
        25526
    );
    assert.equal(urls.length, 1);

    // A different tag is a different lookup
    await getTagCount([{ key: 'leisure', op: '=', value: 'swimming_pool' }], { fetchImpl });
    assert.equal(urls.length, 2);
    assert.match(urls[1], /value=swimming_pool$/);

    // A key filter and a value filter on the same key are not the same tag
    await getTagCount([{ key: 'attraction', op: 'exists' }], { fetchImpl });
    assert.equal(urls.length, 3);
    assert.match(urls[2], /key\/stats\?key=attraction$/);
});

test('a search is as common as its rarest tag', async () => {
    resetTaginfoState();
    const counts = {
        'leisure=swimming_pool': 3048651,
        'swimming_pool=lazy_river': 742
    };
    const urls = [];
    const fetchImpl = async (url) => {
        urls.push(url);
        const parsed = new URL(url);
        const key = `${parsed.searchParams.get('key')}=${parsed.searchParams.get('value')}`;
        return { ok: true, json: async () => ({ data: [{ type: 'ways', count: counts[key] }] }) };
    };

    const filters = [
        { key: 'leisure', op: '=', value: 'swimming_pool' },
        { key: 'swimming_pool', op: '=', value: 'lazy_river' }
    ];

    // Three million pools, but only 742 of them are lazy rivers, so the search
    // is a rare one and must not be planned as if it were the pools
    assert.equal(await getTagCount(filters, { fetchImpl }), 742);
    assert.equal(urls.length, 2);

    // A tag nobody could count does not hide one that could
    assert.equal(await getTagCount([...filters, { key: 'name', op: '~', value: '^A' }], { fetchImpl }), 742);
    assert.equal(urls.length, 2, 'both counts were already known');
});

test('the same tag in flight twice is asked for once', async () => {
    resetTaginfoState();
    let calls = 0;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const fetchImpl = async () => {
        calls++;
        await held;
        return { ok: true, json: async () => WATER_SLIDE_STATS };
    };
    const slides = [{ key: 'attraction', op: '=', value: 'water_slide' }];

    const first = getTagCount(slides, { fetchImpl });
    const second = getTagCount(slides, { fetchImpl });

    release();
    assert.deepEqual(await Promise.all([first, second]), [25526, 25526]);
    assert.equal(calls, 1, 'a double-click must not become two requests');
});

test('a count that arrived elsewhere is used without asking', async () => {
    resetTaginfoState();
    const never = async () => { throw new Error('should not have been called'); };
    const lazyRiver = { key: 'swimming_pool', op: '=', value: 'lazy_river' };

    // A preset's baked count, or the count on the taginfo row the user picked
    seedTagCount(lazyRiver, 742);
    assert.equal(await getTagCount([lazyRiver], { fetchImpl: never }), 742);

    seedTagCount({ key: 'name', op: 'exists' }, 157495);
    assert.equal(await getTagCount([{ key: 'name', op: 'exists' }], { fetchImpl: never }), 157495);

    // Nothing worth remembering is remembered
    for (const bad of [
        [null, 5],
        [{ op: '=', value: 'x' }, 5],
        [{ key: 'a', op: '!=', value: 'b' }, 5],
        [{ key: 'b', op: '=', value: 'c' }, -1],
        [{ key: 'b', op: '=', value: 'c' }, 'lots'],
        [{ key: 'b', op: '=', value: 'c' }, undefined]
    ]) {
        seedTagCount(bad[0], bad[1]);
    }
    assert.equal(
        await getTagCount([{ key: 'b', op: '=', value: 'c' }], {
            fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ type: 'ways', count: 9 }] }) })
        }),
        9,
        'a rejected seed leaves the tag unknown, not wrong'
    );
});

test('the tag count cache does not grow without bound', async () => {
    resetTaginfoState();
    const fetchImpl = async () => ({ ok: true, json: async () => ({ data: [{ type: 'ways', count: 1 }] }) });
    const filterFor = i => [{ key: 'k', op: '=', value: `v${i}` }];

    // More tags than the cache is willing to keep
    for (let i = 0; i < 120; i++) {
        await getTagCount(filterFor(i), { fetchImpl });
    }

    let calls = 0;
    const counting = async (url, options) => {
        calls++;
        return fetchImpl(url, options);
    };

    // 120 lookups, 100 kept: the oldest are gone and asked for again
    await getTagCount(filterFor(0), { fetchImpl: counting });
    assert.equal(calls, 1, 'the oldest tag was evicted');
    await getTagCount(filterFor(119), { fetchImpl: counting });
    assert.equal(calls, 1, 'the newest is still known');
});

test('not knowing how common a tag is costs nothing', async () => {
    // The module warns about these on purpose; the test need not print them
    const warn = console.warn;
    console.warn = () => {};

    try {
        resetTaginfoState();
        const slides = [{ key: 'attraction', op: '=', value: 'water_slide' }];
        const never = async () => { throw new Error('should not have been called'); };

        // Nothing countable in the search: no request, and no answer
        assert.equal(await getTagCount([{ key: 'name', op: '~', value: '^A' }], { fetchImpl: never }), null);
        assert.equal(await getTagCount([], { fetchImpl: never }), null);
        assert.equal(await getTagCount(undefined, { fetchImpl: never }), null);

        assert.equal(await getTagCount(slides, {
            fetchImpl: async () => ({ ok: false, status: 503 })
        }), null);
        assert.equal(await getTagCount(slides, {
            fetchImpl: async () => { throw new TypeError('network down'); }
        }), null);
        assert.equal(await getTagCount(slides, {
            fetchImpl: async () => ({ ok: true, json: async () => ({ data: [] }) })
        }), null);

        // None of those failures is remembered: a search a minute later must
        // still get the real answer, not the shape a bad minute chose
        assert.equal(await getTagCount(slides, {
            fetchImpl: async () => ({ ok: true, json: async () => WATER_SLIDE_STATS })
        }), 25526);
    } finally {
        console.warn = warn;
    }
});

test('the preset file answers when taginfo cannot', async () => {
    // The generated preset file carries a taginfo count for every record, so
    // the rarity of most things anyone searches for is already on this
    // machine. It has to be consulted first, because taginfo being down is
    // exactly when choosing the wrong query shape hurts most
    const { resetPresetCache, loadPresets } = await import('../docs/js/search/presets.js');
    const presets = JSON.parse(readFileSync(
        fileURLToPath(new URL('../docs/data/presets.json', import.meta.url)), 'utf8'
    ));

    resetPresetCache();
    resetTaginfoState();
    await loadPresets(`data:application/json,${encodeURIComponent(JSON.stringify(presets))}`);

    const warn = console.warn;
    console.warn = () => {};

    try {
        const never = async () => { throw new TypeError('taginfo is down'); };
        const cathedrals = parseQlFilters(FEATURES.cathedrals.tags);
        const count = await getTagCount(cathedrals, { fetchImpl: never });

        assert.ok(count !== null, 'the preset file knew, so taginfo was not needed');
        assert.ok(
            count < RARE_TAG_THRESHOLD,
            `building=cathedral is rare (${count}), so France gets the tag-driven shape`
        );
        assert.equal(shapeForTagCount(count), 'tag');

        // A tagging no preset names is still nobody's business but taginfo's
        assert.equal(
            await getTagCount([{ key: 'basin', op: '=', value: 'cooling' }], { fetchImpl: never }),
            null
        );

    } finally {
        console.warn = warn;
        resetPresetCache();
    }
});

test('only a preset that is about one tag can speak for it', async () => {
    const { resetPresetCache, loadPresets } = await import('../docs/js/search/presets.js');
    const synthetic = [
        // Exactly one tag, so its count is that tag's count
        { name: 'Lonely Thing', tags: { lonely: 'thing' }, elementTypes: 'wr', count: 91 },
        // Several tags: the count is that of the rarest of them, an upper
        // bound for the combination and not a figure for either tag
        { name: 'Pair', tags: { paired: 'yes', other: 'no' }, elementTypes: 'wr', count: 40, approx: true }
    ];

    resetPresetCache();
    resetTaginfoState();
    await loadPresets(`data:application/json,${encodeURIComponent(JSON.stringify(synthetic))}`);

    const warn = console.warn;
    console.warn = () => {};

    try {
        const never = async () => { throw new TypeError('taginfo is down'); };

        assert.equal(await getTagCount([{ key: 'lonely', op: '=', value: 'thing' }], { fetchImpl: never }), 91);
        assert.equal(await getTagCount([{ key: 'paired', op: '=', value: 'yes' }], { fetchImpl: never }), null);
        // A different value for the same key is a different tag
        assert.equal(await getTagCount([{ key: 'lonely', op: '=', value: 'other' }], { fetchImpl: never }), null);
        // ...and a key on its own is not what a preset counts
        assert.equal(await getTagCount([{ key: 'lonely', op: 'exists' }], { fetchImpl: never }), null);

        // A real answer still beats the preset to the cache only once: the
        // count is remembered, so the second search asks nobody
        let calls = 0;
        const counting = async () => {
            calls++;
            return { ok: true, json: async () => ({ data: [{ type: 'ways', count: 5 }] }) };
        };
        await getTagCount([{ key: 'paired', op: '=', value: 'yes' }], { fetchImpl: counting });
        await getTagCount([{ key: 'paired', op: '=', value: 'yes' }], { fetchImpl: counting });
        assert.equal(calls, 1);
    } finally {
        console.warn = warn;
        resetPresetCache();
    }
});

test('an abandoned lookup has no answer, so it says so', async () => {
    resetTaginfoState();
    const warnings = [];
    const warn = console.warn;
    console.warn = (...args) => warnings.push(args);

    try {
        const controller = new AbortController();
        controller.abort();

        // The caller cancelled on purpose, so "null, treat it as common" would
        // be an answer about a search nobody is waiting for any more
        const error = await getTagCount([{ key: 'attraction', op: '=', value: 'water_slide' }], {
            signal: controller.signal,
            fetchImpl: async (url, options) => {
                if (options.signal.aborted) {
                    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
                }
                return { ok: true, json: async () => WATER_SLIDE_STATS };
            }
        }).catch(e => e);

        assert.equal(error.name, 'AbortError');
        assert.deepEqual(warnings, [], 'a superseded lookup is not a failure to report');
    } finally {
        console.warn = warn;
    }
});
