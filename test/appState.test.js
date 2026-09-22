/**
 * appState.test.js
 * Tests for the shared state's settings persistence.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { state, STORAGE_KEYS, loadSettings, storeSettings, getRenderOptions } from '../docs/js/state/appState.js';
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
        sortBy: 'nodes-desc'
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
        sortBy: 'size-asc'
    };
    storeSettings(settings);
    assert.deepEqual(loadSettings(), settings);
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
