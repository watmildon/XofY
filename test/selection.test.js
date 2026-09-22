/**
 * selection.test.js
 * Tests for the selection model: what a committed feature or area is, which
 * pairs are allowed, and how a selection survives a share link or storage.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    STORAGE_KEY,
    matchesText,
    typedFeature,
    presetFeature,
    curatedFeature,
    curatedArea,
    placeArea,
    featureLabel,
    areaLabel,
    areaAllowedFor,
    selectionToState,
    selectionFromState,
    loadStoredSelection,
    storeSelection
} from '../docs/js/search/selection.js';

/** A preset record of the shape search/presets.js produces */
const POOL_PRESET = {
    name: 'Swimming Pool',
    tags: { leisure: 'swimming_pool' },
    elementTypes: 'wr',
    count: 3000000
};

/** A place the geocoder might have returned */
const NICE = { osmType: 'relation', osmId: 170100 };

/** A localStorage stand-in that records what was written and removed */
function fakeStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        store,
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    };
}

test('matching a suggestion is loose about case and spacing', () => {
    // An empty field narrows nothing, so every row is offered
    assert.ok(matchesText('Swimming Pools', ''));
    assert.ok(matchesText('Swimming Pools', null));
    assert.ok(matchesText('Swimming Pools', undefined));

    assert.ok(matchesText('Swimming Pools', 'swimming'));
    assert.ok(matchesText('swimming pools', 'POOLS'));
    // What the user typed is trimmed and its runs of space collapsed
    assert.ok(matchesText('Swimming Pools', '  swimming   pools  '));
    assert.ok(matchesText('New York City, NY', 'york city'));

    assert.ok(!matchesText('Swimming Pools', 'lighthouse'));
    assert.ok(!matchesText('Swimming Pools', 'swimmingpools'));

    // A display name is always a string, but the haystack is coerced anyway
    assert.ok(matchesText(1234, '23'));
    assert.ok(!matchesText(null, 'swimming'));
});

test('typed tags become a free-form feature, plain words do not', () => {
    assert.deepEqual(typedFeature('leisure=park'), {
        kind: 'free',
        filters: [{ key: 'leisure', op: '=', value: 'park' }],
        expression: 'leisure=park',
        label: '',
        elementTypes: 'wr'
    });

    // Canonical form, not the text as typed
    assert.equal(typedFeature('leisure = park').expression, 'leisure=park');
    assert.equal(typedFeature('lighthouse=*').expression, 'lighthouse=*');

    // The feature list's job, or still half typed
    assert.equal(typedFeature('lighthouse'), null);
    assert.equal(typedFeature('swimming pool'), null);
    assert.equal(typedFeature('leisure='), null);
    assert.equal(typedFeature(''), null);
});

test('a preset keeps its name and its element types', () => {
    assert.deepEqual(presetFeature(POOL_PRESET), {
        kind: 'free',
        filters: [{ key: 'leisure', op: '=', value: 'swimming_pool' }],
        expression: 'leisure=swimming_pool',
        label: 'Swimming Pool',
        elementTypes: 'wr'
    });

    // A preset with no geometry of its own falls back to the default
    assert.equal(presetFeature({ name: 'Bench', tags: { amenity: 'bench' } }).elementTypes, 'wr');
    assert.equal(presetFeature({ name: 'Street', tags: { highway: '*' }, elementTypes: 'way' }).elementTypes, 'way');
    assert.deepEqual(presetFeature({ name: 'Street', tags: { highway: '*' } }).filters, [
        { key: 'highway', op: 'exists' }
    ]);
});

test('the field shows a name for a curated or named feature, tags otherwise', () => {
    assert.equal(featureLabel(curatedFeature('swimming_pools')), 'Swimming Pools');
    assert.equal(featureLabel(presetFeature(POOL_PRESET)), 'Swimming Pool');
    // A label from a link is not shown until it has been verified
    assert.equal(featureLabel(typedFeature('leisure=swimming_pool')), 'leisure=swimming_pool');

    assert.equal(areaLabel(curatedArea('france')), 'France');
    assert.equal(areaLabel(placeArea(NICE, 'Nice, France')), 'Nice, France');
});

test('a curated feature only allows the areas it is meant for', () => {
    // Churches need admin_level 8 or finer, so a country is too coarse
    assert.ok(areaAllowedFor(curatedFeature('churches'), curatedArea('seattle')));
    assert.ok(!areaAllowedFor(curatedFeature('churches'), curatedArea('france')));
    assert.ok(!areaAllowedFor(curatedFeature('churches'), curatedArea('world')));

    // Cathedrals name their areas explicitly
    assert.ok(areaAllowedFor(curatedFeature('cathedrals'), curatedArea('france')));
    assert.ok(!areaAllowedFor(curatedFeature('cathedrals'), curatedArea('seattle')));
});

test('any curated feature may be pointed at a searched place', () => {
    // The curated list is only a shortlist; a searched place is sized before
    // it runs, so a feature with an allowed list is not confined to it
    assert.ok(areaAllowedFor(curatedFeature('historic_aircraft'), placeArea(NICE, 'Nice, France')));
    assert.ok(areaAllowedFor(curatedFeature('roller_coasters'), placeArea(NICE, 'Nice, France')));
    assert.ok(areaAllowedFor(curatedFeature('subway_routes'), placeArea(NICE, 'Nice, France')));
    assert.ok(areaAllowedFor(curatedFeature('churches'), placeArea(NICE, 'Nice, France')));
});

test('a free-form feature has no area rules at all', () => {
    const free = typedFeature('leisure=park');

    assert.ok(areaAllowedFor(free, curatedArea('world')));
    assert.ok(areaAllowedFor(free, curatedArea('seattle')));
    assert.ok(areaAllowedFor(free, placeArea(NICE, 'Nice, France')));

    // Half a selection is never the thing that is wrong
    assert.ok(areaAllowedFor(null, curatedArea('seattle')));
    assert.ok(areaAllowedFor(curatedFeature('subway_routes'), null));
    assert.ok(areaAllowedFor(null, null));
});

test('an empty selection is an empty state', () => {
    assert.deepEqual(selectionToState(null, null), {
        feature: '', x: '', xLabel: '', xElementTypes: '', area: '', y: null, yLabel: ''
    });
    assert.deepEqual(selectionFromState(null), { feature: null, area: null, pendingLabel: '' });
    assert.deepEqual(selectionFromState({}), { feature: null, area: null, pendingLabel: '' });
});

test('curated feature in a curated area survives a round trip', () => {
    const feature = curatedFeature('churches');
    const area = curatedArea('seattle');
    const state = selectionToState(feature, area);

    assert.deepEqual(state, {
        feature: 'churches', x: '', xLabel: '', xElementTypes: '', area: 'seattle', y: null, yLabel: ''
    });

    const back = selectionFromState(state);
    assert.deepEqual(back.feature, feature);
    assert.deepEqual(back.area, area);
    assert.equal(back.pendingLabel, '');
});

test('curated feature in a searched place survives a round trip', () => {
    const feature = curatedFeature('churches');
    const area = placeArea(NICE, 'Nice, France');
    const state = selectionToState(feature, area);

    assert.deepEqual(state, {
        feature: 'churches', x: '', xLabel: '', xElementTypes: '',
        area: '', y: NICE, yLabel: 'Nice, France'
    });
    assert.deepEqual(selectionFromState(state), { feature, area, pendingLabel: '' });
});

test('free-form feature in a curated area survives a round trip', () => {
    const feature = typedFeature('leisure=park name');
    const area = curatedArea('france');
    const state = selectionToState(feature, area);

    assert.deepEqual(state, {
        feature: '', x: 'leisure=park name=*', xLabel: '', xElementTypes: 'wr',
        area: 'france', y: null, yLabel: ''
    });
    assert.deepEqual(selectionFromState(state), { feature, area, pendingLabel: '' });
});

test('free-form feature in a searched place survives a round trip', () => {
    const feature = presetFeature({ name: 'Street', tags: { highway: '*' }, elementTypes: 'way' });
    const area = placeArea(NICE, 'Nice, France');
    const state = selectionToState(feature, area);

    assert.deepEqual(state, {
        feature: '', x: 'highway=*', xLabel: 'Street', xElementTypes: 'way',
        area: '', y: NICE, yLabel: 'Nice, France'
    });

    // The name comes back as a claim to be checked, not as the label itself
    const back = selectionFromState(state);
    assert.equal(back.pendingLabel, 'Street');
    assert.deepEqual(back.feature, { ...feature, label: '' });
    assert.deepEqual(back.area, area);
});

test('a place with no name of its own is labelled by its reference', () => {
    assert.deepEqual(selectionFromState({ y: { osmType: 'relation', osmId: 170100 } }).area,
        placeArea(NICE, 'relation 170100'));
});

test('a state from outside is checked rather than trusted', () => {
    // A curated key wins over any tags alongside it, and its label claim with it
    const both = selectionFromState({ feature: 'churches', x: 'leisure=park', xLabel: 'Park' });
    assert.deepEqual(both.feature, curatedFeature('churches'));
    assert.equal(both.pendingLabel, '');

    // A feature key this build does not have
    assert.equal(selectionFromState({ feature: 'teleporters' }).feature, null);
    // ...and it does not fall through to a free-form reading of nothing
    assert.equal(selectionFromState({ feature: 'teleporters', x: '' }).feature, null);

    // Text that is not a searchable expression
    assert.equal(selectionFromState({ x: 'leisure=' }).feature, null);
    assert.equal(selectionFromState({ x: 'swimming pool' }).feature, null);
    assert.equal(selectionFromState({ x: '=' }).feature, null);

    // A node has no area for map_to_area, and junk is junk
    assert.equal(selectionFromState({ y: { osmType: 'node', osmId: 1 } }).area, null);
    assert.equal(selectionFromState({ y: { osmType: 'relation', osmId: -5 } }).area, null);
    assert.equal(selectionFromState({ y: 'r170100' }).area, null);
    assert.equal(selectionFromState({ area: 'atlantis' }).area, null);

    // An element type nobody may ask for falls back to the default
    assert.equal(selectionFromState({ x: 'leisure=park', xElementTypes: 'node' }).feature.elementTypes, 'wr');
    assert.equal(selectionFromState({ x: 'leisure=park', xElementTypes: 'rel' }).feature.elementTypes, 'rel');
});

test('a bare key from a link is accepted and shown as key=*', () => {
    // Nobody typed this, so there is no ambiguity with a plain word
    const { feature } = selectionFromState({ x: 'building' });

    assert.deepEqual(feature, {
        kind: 'free',
        filters: [{ key: 'building', op: 'exists' }],
        expression: 'building=*',
        label: '',
        elementTypes: 'wr'
    });
    assert.equal(featureLabel(feature), 'building=*');
});

test('a selection is stored and read back under the key the app has always used', () => {
    const storage = fakeStorage();
    globalThis.localStorage = storage;

    const state = selectionToState(curatedFeature('churches'), curatedArea('seattle'));
    storeSelection(state);

    assert.deepEqual([...storage.store.keys()], [STORAGE_KEY]);
    // Byte for byte what the app has always written, field order included
    assert.equal(storage.store.get(STORAGE_KEY),
        '{"feature":"churches","x":"","xLabel":"","xElementTypes":"","area":"seattle","y":null,"yLabel":""}');
    assert.deepEqual(loadStoredSelection(), state);
});

test('an empty selection removes what was stored', () => {
    const storage = fakeStorage();
    globalThis.localStorage = storage;

    storeSelection(selectionToState(curatedFeature('churches'), null));
    assert.equal(storage.store.size, 1);

    storeSelection(selectionToState(null, null));
    assert.equal(storage.store.size, 0);
    assert.equal(loadStoredSelection(), null);
});

test('unreadable or unwritable storage is not fatal', () => {
    globalThis.localStorage = fakeStorage({ [STORAGE_KEY]: 'not json' });
    const original = console.warn;
    console.warn = () => {};

    try {
        assert.equal(loadStoredSelection(), null);

        globalThis.localStorage = { getItem() { throw new Error('blocked'); } };
        assert.equal(loadStoredSelection(), null);

        globalThis.localStorage = { setItem() { throw new Error('blocked'); } };
        assert.doesNotThrow(() => storeSelection(selectionToState(curatedFeature('churches'), null)));
    } finally {
        console.warn = original;
    }

    // A stored value that is not an object is no selection either
    globalThis.localStorage = fakeStorage({ [STORAGE_KEY]: '"a string"' });
    assert.equal(loadStoredSelection(), null);
});
