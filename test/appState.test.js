/**
 * appState.test.js
 * Tests for the shared state's settings persistence.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    state,
    STORAGE_KEYS,
    loadSettings,
    storeSettings,
    getRenderOptions,
    detectQueryLanguage,
    inferQueryLanguage
} from '../docs/js/state/appState.js';
import { DEFAULT_OVERPASS_URL } from '../docs/js/overpassClient.js';

/** A localStorage stand-in that records what was written */
function fakeStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        store,
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value))
    };
}

test('loadSettings returns the defaults from an empty storage', () => {
    globalThis.localStorage = fakeStorage();
    assert.deepEqual(loadSettings(), {
        query: '',
        fillColor: '#3388ff',
        scaleToggle: false,
        overpassUrl: DEFAULT_OVERPASS_URL,
        theme: null,
        groupByTag: '',
        respectOsmColors: true,
        sortBy: 'nodes-desc',
        // Postpass needs no server of one's own, so it is where a new visitor
        // starts, and the Query tab starts in the language it speaks
        backend: 'postpass',
        queryLang: 'sql'
    });
});

test('settings survive a store/load round trip', () => {
    globalThis.localStorage = fakeStorage();
    const settings = {
        query: '[out:json];\nway[x];\nout geom;',
        fillColor: '#ff0000',
        scaleToggle: true,
        overpassUrl: 'https://overpass-api.de/api/interpreter',
        theme: 'dark',
        groupByTag: 'name',
        respectOsmColors: false,
        sortBy: 'size-asc',
        backend: 'overpass',
        queryLang: 'ql'
    };
    storeSettings(settings);
    assert.deepEqual(loadSettings(), settings);
});

test('a backend from storage is one of ours or the default', () => {
    for (const [saved, expected] of [
        ['overpass', 'overpass'],
        ['postpass', 'postpass'],
        ['something-else', 'postpass'],
        ['', 'postpass']
    ]) {
        globalThis.localStorage = fakeStorage({ 'xofy-osm-backend': saved });
        assert.equal(loadSettings().backend, expected, saved);
    }

    // A page that has never had a language of its own takes the backend's
    globalThis.localStorage = fakeStorage({ 'xofy-osm-backend': 'overpass' });
    assert.equal(loadSettings().queryLang, 'ql');
    globalThis.localStorage = fakeStorage({ 'xofy-osm-backend': 'postpass' });
    assert.equal(loadSettings().queryLang, 'sql');

    // ...and a language that was set on its own is kept, whatever it is about
    globalThis.localStorage = fakeStorage({ 'xofy-osm-backend': 'postpass', 'xofy-osm-query-lang': 'ql' });
    assert.equal(loadSettings().queryLang, 'ql');
    globalThis.localStorage = fakeStorage({ 'xofy-osm-query-lang': 'nonsense' });
    assert.equal(loadSettings().queryLang, 'sql');
});

test('values are written under the keys the app has always used', () => {
    const storage = fakeStorage();
    globalThis.localStorage = storage;
    storeSettings({
        query: 'q', fillColor: '#123456', scaleToggle: false, overpassUrl: 'u',
        theme: 'light', groupByTag: '', respectOsmColors: true, sortBy: 'default'
    });
    assert.deepEqual([...storage.store.keys()].sort(), Object.values(STORAGE_KEYS).sort());
    assert.equal(storage.store.get('xofy-osm-scale-toggle'), 'false');
    assert.equal(storage.store.get('xofy-osm-respect-osm-colors'), 'true');
});

test('an empty group-by tag is kept, not replaced by the default', () => {
    globalThis.localStorage = fakeStorage({ 'xofy-osm-group-by-tag': '' });
    assert.equal(loadSettings().groupByTag, '');
});

test('unreadable storage falls back to the defaults without throwing', () => {
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const original = console.warn;
    console.warn = () => {};
    try {
        assert.equal(loadSettings().sortBy, 'nodes-desc');
        assert.doesNotThrow(() => storeSettings({ query: '' }));
    } finally {
        console.warn = original;
    }
});

test('Postpass is the default backend until a choice is stored', () => {
    // A stand-in for a custom server. The real one lives in the owner's
    // browser and has no business in a test, a log or a fixture
    const OWN_SERVER = 'https://overpass.example.invalid/api/interpreter';

    globalThis.localStorage = fakeStorage({});
    assert.equal(loadSettings().backend, 'postpass');

    // A configured Overpass server does not change the default; it is kept
    // for when Overpass is chosen
    globalThis.localStorage = fakeStorage({ 'xofy-osm-overpass-url': OWN_SERVER });
    assert.equal(loadSettings().backend, 'postpass');
    assert.equal(loadSettings().overpassUrl, OWN_SERVER);

    globalThis.localStorage = fakeStorage({ 'xofy-osm-backend': 'overpass' });
    assert.equal(loadSettings().backend, 'overpass');

    globalThis.localStorage = fakeStorage({ 'xofy-osm-backend': 'nonsense' });
    assert.equal(loadSettings().backend, 'postpass', 'junk falls back to the default');
});

test('a saved query says which language it is in', () => {
    assert.equal(detectQueryLanguage('[out:json];\nway[x];\nout geom;'), 'ql');
    assert.equal(detectQueryLanguage('way[x];\nout geom;'), 'ql', 'an out statement is enough');
    assert.equal(detectQueryLanguage('[out:json][timeout:60];'), 'ql');
    assert.equal(detectQueryLanguage('SELECT p.osm_id FROM postpass_line p'), 'sql');
    assert.equal(detectQueryLanguage('  \n\nselect 1'), 'sql', 'case and blank lines do not matter');
    assert.equal(detectQueryLanguage('WITH a AS MATERIALIZED (SELECT 1) SELECT 2'), 'sql');
    assert.equal(detectQueryLanguage('-- a comment\nSELECT 1'), 'sql');

    // Nothing to go on
    assert.equal(detectQueryLanguage(''), null);
    assert.equal(detectQueryLanguage('   '), null);
    assert.equal(detectQueryLanguage(undefined), null);
    assert.equal(detectQueryLanguage('rel(170100);'), null);

    // The backend decides only when the text does not
    assert.equal(inferQueryLanguage('rel(170100);', 'postpass'), 'sql');
    assert.equal(inferQueryLanguage('rel(170100);', 'overpass'), 'ql');
    assert.equal(inferQueryLanguage('SELECT 1', 'overpass'), 'sql', 'the text wins');
    assert.equal(inferQueryLanguage('[out:json];out count;', 'postpass'), 'ql');
});

test('an old saved query comes back in its own language', () => {
    // Someone upgrading has a query in the box and no language recorded. It
    // must not reappear labelled as SQL just because Postpass is now default
    globalThis.localStorage = fakeStorage({ 'xofy-osm-query': '[out:json];\nout count;' });
    const upgraded = loadSettings();
    assert.equal(upgraded.backend, 'postpass');
    assert.equal(upgraded.queryLang, 'ql');

    // A saved SELECT is SQL whatever backend is in force
    globalThis.localStorage = fakeStorage({
        'xofy-osm-query': 'SELECT p.osm_id FROM postpass_line p',
        'xofy-osm-backend': 'overpass'
    });
    const mixed = loadSettings();
    assert.equal(mixed.backend, 'overpass');
    assert.equal(mixed.queryLang, 'sql');

    // An empty box falls back to the backend's language, as before
    globalThis.localStorage = fakeStorage({});
    assert.equal(loadSettings().queryLang, 'sql');

    // ...and a recorded language is never second-guessed
    globalThis.localStorage = fakeStorage({
        'xofy-osm-query': '[out:json];out count;',
        'xofy-osm-query-lang': 'sql'
    });
    assert.equal(loadSettings().queryLang, 'sql');
});

test('render options mirror the shared state', () => {
    state.fillColor = '#00ff00';
    state.maxDimension = 42;
    state.respectOsmColors = false;
    state.maintainRelativeSize = true;
    assert.deepEqual(getRenderOptions(), {
        maintainRelativeSize: true,
        maxDimension: 42,
        fillColor: '#00ff00',
        respectOsmColors: false
    });
});
