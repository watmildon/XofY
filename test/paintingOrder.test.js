/**
 * paintingOrder.test.js
 * Tests the order sub-features are painted in: biggest first, so that what
 * sits inside a feature lands on top of it rather than under it.
 *
 * The fixture is the american football pitch at Orem, Utah (way 986088569),
 * the case that turned the bug up. Its surround is one large multipolygon
 * relation whose holes are the field and the end zone lettering, and the
 * letters themselves are part plain ways and part relations. Overpass hands
 * them back ways first, so painting in arrival order drops the surround on
 * top of the eight letter ways and buries them.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { paintingOrder } from '../docs/js/canvasRenderer.js';
import { parseElements } from '../docs/js/geometryParser.js';
import { partitionElements, attachSubFeatures } from '../docs/js/geometry/subFeatures.js';

/** The pitch the fixture is centred on */
const PITCH_ID = 986088569;
/** The dark red surround: one outer ring, the rest of the pitch as holes */
const SURROUND_ID = 13257461;
/** The colour the end zone lettering is tagged with */
const LETTER_COLOUR = '#BCA863';

const MAIN_FILTERS = [
    { key: 'leisure', op: '=', value: 'pitch' },
    { key: 'sport', op: '=', value: 'american_football' }
];
const SUB_FILTERS = [{ key: 'leisure', op: '=', value: 'pitch_surface' }];

/**
 * The fixture, run through the pipeline the renderer is handed the end of
 * @returns {Object} The parsed pitch, with its sub-features attached
 */
function pitchWithSubFeatures() {
    const data = JSON.parse(readFileSync(
        new URL('./data/pitch_surfaces_football.json', import.meta.url), 'utf8'
    ));
    const { main, sub } = partitionElements(data.elements, {
        subFilters: SUB_FILTERS,
        mainFilters: MAIN_FILTERS
    });
    const mains = parseElements(main, {}).geometries;
    const subs = parseElements(sub, { nodes: true, coalesce: false }).geometries;

    attachSubFeatures(mains, subs, {});

    return mains.find(geom => geom.id === PITCH_ID);
}

/** A bounding box, for the sizes the order is built from */
const box = (minLon, minLat, maxLon, maxLat) => ({ bounds: { minLon, minLat, maxLon, maxLat } });

test('the biggest sub-feature is painted first, so it lands underneath', () => {
    const small = { id: 'small', ...box(0, 0, 1, 1) };
    const big = { id: 'big', ...box(0, 0, 10, 10) };
    const middle = { id: 'middle', ...box(0, 0, 3, 3) };

    assert.deepEqual(
        paintingOrder([small, big, middle]).map(sub => sub.id),
        ['big', 'middle', 'small']
    );
});

test('sub-features of equal size keep the order they arrived in', () => {
    const first = { id: 'first', ...box(0, 0, 2, 2) };
    const second = { id: 'second', ...box(5, 5, 7, 7) };

    assert.deepEqual(
        paintingOrder([first, second]).map(sub => sub.id),
        ['first', 'second']
    );
});

test('a sub-feature without usable bounds sorts last rather than throwing', () => {
    const sized = { id: 'sized', ...box(0, 0, 4, 4) };
    const boundless = { id: 'boundless' };
    const empty = { id: 'empty', bounds: { minLon: NaN, minLat: 0, maxLon: 1, maxLat: 1 } };

    assert.deepEqual(
        paintingOrder([boundless, sized, empty]).map(sub => sub.id),
        ['sized', 'boundless', 'empty']
    );
});

test('the order given is left as it was', () => {
    const subs = [{ id: 'a', ...box(0, 0, 1, 1) }, { id: 'b', ...box(0, 0, 9, 9) }];
    const before = subs.slice();

    paintingOrder(subs);

    assert.deepEqual(subs, before);
});

test('a higher layer is painted over a lower one, whatever the sizes', () => {
    // The big one would win on size alone, so only layer can put it underneath
    const below = { id: 'below', tags: { layer: '1' }, ...box(0, 0, 1, 1) };
    const above = { id: 'above', tags: { layer: '2' }, ...box(0, 0, 10, 10) };
    const ground = { id: 'ground', ...box(0, 0, 5, 5) };

    assert.deepEqual(
        paintingOrder([below, above, ground]).map(sub => sub.id),
        ['ground', 'below', 'above']
    );
});

test('a negative layer is painted under the untagged ground', () => {
    // The buried one is the smaller, so size alone would put it on top
    const ground = { id: 'ground', ...box(0, 0, 9, 9) };
    const buried = { id: 'buried', tags: { layer: '-1' }, ...box(0, 0, 2, 2) };

    assert.deepEqual(
        paintingOrder([ground, buried]).map(sub => sub.id),
        ['buried', 'ground']
    );
});

test('size still settles the order within one layer', () => {
    const small = { id: 'small', tags: { layer: '1' }, ...box(0, 0, 1, 1) };
    const big = { id: 'big', tags: { layer: '1' }, ...box(0, 0, 9, 9) };

    assert.deepEqual(
        paintingOrder([small, big]).map(sub => sub.id),
        ['big', 'small']
    );
});

test('a layer that is not a plain integer counts as ground', () => {
    // `1;2`, a decimal, a unit and an empty value all say nothing usable
    const odd = ['1;2', '1.5', '1m', '', '   ', 'yes'];

    for (const layer of odd) {
        // Read as a layer of any kind, the big one would be forced off the
        // bottom; counted as ground, it stays there on size
        const tagged = { id: 'tagged', tags: { layer }, ...box(0, 0, 9, 9) };
        const ground = { id: 'ground', ...box(0, 0, 1, 1) };

        assert.deepEqual(
            paintingOrder([tagged, ground]).map(sub => sub.id),
            ['tagged', 'ground'],
            `layer=${JSON.stringify(layer)} should have counted as ground`
        );
    }
});

test('a signed or out-of-range layer is read rather than dropped', () => {
    const plus = { id: 'plus', tags: { layer: '+1' }, ...box(0, 0, 9, 9) };
    const ground = { id: 'ground', ...box(0, 0, 1, 1) };
    // Clamped to the top of the range, so still above everything
    const high = { id: 'high', tags: { layer: '50' }, ...box(0, 0, 9, 9) };

    assert.deepEqual(
        paintingOrder([plus, ground]).map(sub => sub.id),
        ['ground', 'plus']
    );
    assert.deepEqual(
        paintingOrder([high, plus, ground]).map(sub => sub.id),
        ['ground', 'plus', 'high']
    );
});

test('a numeric layer is read the same as a written one', () => {
    // Bigger, so only the layer can lift it above the ground
    const tagged = { id: 'tagged', tags: { layer: 1 }, ...box(0, 0, 9, 9) };
    const ground = { id: 'ground', ...box(0, 0, 1, 1) };

    assert.deepEqual(
        paintingOrder([tagged, ground]).map(sub => sub.id),
        ['ground', 'tagged']
    );
});

test('every end zone letter is painted over the surround that encloses them', () => {
    const pitch = pitchWithSubFeatures();
    const order = paintingOrder(pitch.subFeatures);
    const positionOf = new Map(order.map((sub, index) => [sub.id, index]));
    const surround = positionOf.get(SURROUND_ID);
    const letters = order.filter(sub => sub.tags?.colour === LETTER_COLOUR);

    // The fixture is only worth its size if it still holds both kinds of letter
    assert.ok(letters.some(sub => sub.type === 'way'), 'expected letters drawn as ways');
    assert.ok(letters.some(sub => sub.type === 'relation'), 'expected letters drawn as relations');

    assert.equal(surround, 0, 'the surround covers the pitch, so it is painted first');
    for (const letter of letters) {
        assert.ok(
            positionOf.get(letter.id) > surround,
            `letter ${letter.type} ${letter.id} is painted under the surround`
        );
    }
});

test('the surround arrives after the letters it would otherwise bury', () => {
    const pitch = pitchWithSubFeatures();
    const arrival = pitch.subFeatures.findIndex(sub => sub.id === SURROUND_ID);
    const buried = pitch.subFeatures
        .slice(0, arrival)
        .filter(sub => sub.tags?.colour === LETTER_COLOUR);

    assert.ok(buried.length > 0, 'fixture no longer reproduces the arrival order bug');
});
