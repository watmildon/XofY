/**
 * nominatim.test.js
 * Tests for the pure parts of the place search: result filtering/mapping, the
 * request URL, and the bounded cache. The fixture is one real captured
 * response for "Nice, France".
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    mapResults,
    normaliseQuery,
    buildSearchUrl,
    pruneCache,
    readCache,
    writeCache,
    searchPlaces,
    resetSearchState,
    boundingBoxAreaKm2,
    formatAreaKm2
} from '../docs/js/search/nominatim.js';

const FIXTURE = JSON.parse(readFileSync(
    fileURLToPath(new URL('./data/nominatim-nice.json', import.meta.url)),
    'utf8'
));

const ABBEY_ROAD = JSON.parse(readFileSync(
    fileURLToPath(new URL('./data/nominatim-abbey-road.json', import.meta.url)),
    'utf8'
));

/**
 * A stand-in for localStorage
 * @returns {Object} A storage-like object backed by a Map
 */
function fakeStorage() {
    const map = new Map();
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
        get size() {
            return map.size;
        }
    };
}

test('the captured response offers both Nice boundaries', () => {
    const { places, total } = mapResults(FIXTURE);

    assert.equal(total, FIXTURE.length);
    assert.ok(places.length >= 2);

    const ids = places.map(place => place.osmId);
    assert.ok(ids.includes(170100), 'the commune (rel 170100) should be offered');
    assert.ok(ids.includes(1670977), 'the arrondissement (rel 1670977) should be offered too');

    const commune = places.find(place => place.osmId === 170100);
    assert.equal(commune.osmType, 'relation');
    assert.match(commune.label, /^Nice, Alpes-Maritimes/);
    assert.ok(commune.hint, 'a short type hint is shown beside the name');
    assert.notEqual(commune.hint, places.find(p => p.osmId === 1670977).hint,
        'the hints are what tell two same-named results apart');
});

test('keeps only results that can become an area', () => {
    const { places, total } = mapResults([
        { osm_type: 'node', osm_id: 1, display_name: 'A point' },
        { osm_type: 'relation', osm_id: 2, display_name: 'A boundary', addresstype: 'city' },
        { osm_type: 'way', osm_id: 3, display_name: 'A campus', type: 'university' },
        { osm_type: 'relation', osm_id: 0, display_name: 'No id' },
        { osm_type: 'relation', display_name: 'Missing id' },
        { osm_type: 'RELATION', osm_id: 4, display_name: 'Shouty' }
    ]);

    assert.equal(total, 6);
    assert.deepEqual(places.map(place => `${place.osmType}/${place.osmId}`), [
        'relation/2', 'way/3', 'relation/4'
    ]);
});

test('says nothing usable was found when every result is a point', () => {
    const { places, total } = mapResults([
        { osm_type: 'node', osm_id: 1, display_name: 'Just a point' }
    ]);

    // total > 0 with no places is what makes the "only a point" message right
    assert.equal(places.length, 0);
    assert.equal(total, 1);
});

test('copes with junk input', () => {
    assert.deepEqual(mapResults(null), { places: [], total: 0 });
    assert.deepEqual(mapResults(undefined), { places: [], total: 0 });
    assert.deepEqual(mapResults('nonsense'), { places: [], total: 0 });
    assert.deepEqual(mapResults([{}]), { places: [], total: 1 });
});

test('falls back to something printable when a name is missing', () => {
    const { places } = mapResults([{ osm_type: 'relation', osm_id: 7 }]);
    assert.equal(places[0].label, 'relation 7');
    assert.equal(places[0].hint, '');
});

test('normalises queries for the cache', () => {
    assert.equal(normaliseQuery('  Nice,   France '), 'nice, france');
    assert.equal(normaliseQuery('NICE, FRANCE'), 'nice, france');
    assert.equal(normaliseQuery(''), '');
    assert.equal(normaliseQuery(undefined), '');
});

test('builds the documented search URL', () => {
    const url = new URL(buildSearchUrl('Nice, France'));

    assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
    assert.equal(url.searchParams.get('format'), 'jsonv2');
    assert.equal(url.searchParams.get('limit'), '8');
    assert.equal(url.searchParams.get('q'), 'Nice, France');
});

test('prunes the cache by age and by size', () => {
    const now = 1_000_000;
    const cache = {
        fresh: { at: now - 10, places: [] },
        old: { at: now - 999_999_999, places: [] },
        broken: { places: [] },
        newest: { at: now, places: [] }
    };

    assert.deepEqual(Object.keys(pruneCache(cache, { now, ttl: 1000, limit: 10 })), ['newest', 'fresh']);
    assert.deepEqual(Object.keys(pruneCache(cache, { now, ttl: 1000, limit: 1 })), ['newest']);
    assert.deepEqual(pruneCache(null, { now }), {});
});

test('stores and reads results, keeping the cache bounded', () => {
    const storage = fakeStorage();

    writeCache('nice, france', { places: [{ osmId: 170100 }], total: 2 }, storage, 1);
    assert.deepEqual(readCache(storage)['nice, france'].places, [{ osmId: 170100 }]);

    for (let i = 0; i < 40; i++) {
        writeCache(`query ${i}`, { places: [], total: 0 }, storage, 100 + i);
    }

    const cache = readCache(storage);
    assert.equal(Object.keys(cache).length, 25);
    assert.ok(!cache['nice, france'], 'the oldest entry is evicted');
    assert.ok(cache['query 39'], 'the newest entry is kept');
});

test('survives unreadable storage', () => {
    const broken = {
        getItem: () => '{not json',
        setItem: () => { throw new Error('quota'); }
    };

    assert.deepEqual(readCache(broken), {});
    assert.doesNotThrow(() => writeCache('x', { places: [], total: 0 }, broken, 1));
    assert.deepEqual(readCache(null), {});
});

test('searching uses the cache instead of the network the second time', async () => {
    resetSearchState();
    const storage = fakeStorage();
    let calls = 0;

    const fetchImpl = async (url) => {
        calls++;
        assert.match(url, /format=jsonv2/);
        return { ok: true, json: async () => FIXTURE };
    };

    const first = await searchPlaces('Nice, France', { fetchImpl, storage });
    assert.equal(first.cached, false);
    assert.equal(first.places.length, 2);

    // A different spelling of the same query still hits the cache
    const second = await searchPlaces('  nice,  FRANCE ', { fetchImpl, storage });
    assert.equal(second.cached, true);
    assert.equal(second.places.length, 2);
    assert.equal(calls, 1, 'the second search must not call Nominatim');
});

test('an empty query never reaches the network', async () => {
    resetSearchState();
    const fetchImpl = () => assert.fail('should not have searched');

    assert.deepEqual(await searchPlaces('   ', { fetchImpl, storage: fakeStorage() }),
        { places: [], total: 0, cached: false });
});

test('a failed search reports the status', async () => {
    resetSearchState();
    const fetchImpl = async () => ({ ok: false, status: 503 });

    await assert.rejects(
        () => searchPlaces('Somewhere', { fetchImpl, storage: fakeStorage() }),
        /Place search failed: 503/
    );
});

test('estimates how big a place is from its bounding box', () => {
    // A degree of latitude is ~111 km; longitudes narrow towards the poles
    assert.ok(Math.abs(boundingBoxAreaKm2(['0', '1', '0', '1']) - 111.32 * 111.32) < 1);

    const equator = boundingBoxAreaKm2(['0', '1', '0', '1']);
    const north = boundingBoxAreaKm2(['60', '61', '0', '1']);
    assert.ok(north < equator / 1.5, 'the same box is smaller at 60 degrees north');

    assert.equal(boundingBoxAreaKm2(['1', '1', '2', '2']), null, 'a zero-size box has no area');
    assert.equal(boundingBoxAreaKm2(['a', 'b', 'c', 'd']), null);
    assert.equal(boundingBoxAreaKm2(['1', '2']), null);
    assert.equal(boundingBoxAreaKm2(undefined), null);
});

test('formats an area to two significant figures', () => {
    assert.equal(formatAreaKm2(148.3), '~150 km²');
    assert.equal(formatAreaKm2(6612), '~6,600 km²');
    assert.equal(formatAreaKm2(0.746), '~0.75 km²');
    assert.equal(formatAreaKm2(0), '');
    assert.equal(formatAreaKm2(null), '');
    assert.equal(formatAreaKm2(NaN), '');
});

test('the two Nice boundaries are told apart by their size', () => {
    const { places } = mapResults(FIXTURE);
    const commune = places.find(place => place.osmId === 170100);
    const arrondissement = places.find(place => place.osmId === 1670977);

    // "city" and "municipality" alone do not say which one is bigger
    assert.match(commune.hint, /^city · ~\d+ km²$/);
    assert.match(arrondissement.hint, /^municipality · ~[\d,]+ km²$/);

    const size = (place) => Number(place.hint.replace(/[^\d.]/g, ''));
    assert.ok(size(arrondissement) > size(commune) * 5,
        `the arrondissement should dwarf the commune: ${commune.hint} vs ${arrondissement.hint}`);
});

test('a place with no bounding box still gets a hint', () => {
    const { places } = mapResults([{ osm_type: 'relation', osm_id: 5, display_name: 'X', addresstype: 'county' }]);
    assert.equal(places[0].hint, 'county');
});

test('a rate limited search is recognisable', async () => {
    resetSearchState();
    await assert.rejects(
        () => searchPlaces('Somewhere', {
            fetchImpl: async () => ({ ok: false, status: 429 }),
            storage: null
        }),
        (error) => error.status === 429
    );
});

test('streets are not offered as areas', () => {
    // "Abbey Road, London" is eight stretches of road, none of which
    // map_to_area can turn into anything
    const { places, total } = mapResults(ABBEY_ROAD);

    assert.equal(total, 8);
    assert.deepEqual(places, [], 'a way that is a road is not a place to search in');
});

test('other linear features are dropped too', () => {
    const { places } = mapResults([
        { osm_type: 'way', osm_id: 1, category: 'highway', display_name: 'A street' },
        { osm_type: 'way', osm_id: 2, category: 'railway', display_name: 'A line' },
        { osm_type: 'way', osm_id: 3, category: 'waterway', display_name: 'A river' },
        { osm_type: 'relation', osm_id: 4, category: 'waterway', display_name: 'A long river' },
        { osm_type: 'way', osm_id: 5, category: 'amenity', display_name: 'A campus' },
        { osm_type: 'relation', osm_id: 6, category: 'boundary', display_name: 'A town' }
    ]);

    assert.deepEqual(places.map(place => place.osmId), [5, 6]);
});
