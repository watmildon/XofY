/**
 * colorUtils.test.js
 * Tests for turning OSM colour tag values into hex.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// A canvas stand-in that behaves like the real one: it knows a few CSS names
// and keeps its previous fillStyle when handed something it cannot parse
const CSS_NAMES = { red: '#ff0000', lightgray: '#d3d3d3', darkgreen: '#006400', darkred: '#8b0000' };
globalThis.document = {
    createElement() {
        let fill = '#000000';
        return {
            getContext() {
                return {
                    set fillStyle(v) {
                        const name = CSS_NAMES[String(v).toLowerCase()];
                        if (name) fill = name;
                        else if (/^#[0-9a-f]{6}$/i.test(v)) fill = v.toLowerCase();
                    },
                    get fillStyle() { return fill; }
                };
            }
        };
    }
};

const { validateAndConvertColor } = await import('../docs/js/geometry/colorUtils.js');

test('CSS colour names convert to hex', () => {
    assert.equal(validateAndConvertColor('red'), '#FF0000');
    assert.equal(validateAndConvertColor('lightgray'), '#D3D3D3');
});

test('OSM names written with separators are run together', () => {
    assert.equal(validateAndConvertColor('light_gray'), '#D3D3D3');
    assert.equal(validateAndConvertColor('dark green'), '#006400');
    assert.equal(validateAndConvertColor('dark-red'), '#8B0000');
    assert.equal(validateAndConvertColor(' Dark_Green '), '#006400');
});

test('values that are not one colour stay uncoloured', () => {
    assert.equal(validateAndConvertColor('red;white'), null);
    assert.equal(validateAndConvertColor('red and white'), null);
    assert.equal(validateAndConvertColor('dark brown'), null, 'darkbrown is not a CSS name');
    assert.equal(validateAndConvertColor('none'), null);
    assert.equal(validateAndConvertColor(''), null);
});
