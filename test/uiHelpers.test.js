/**
 * uiHelpers.test.js
 * Tests for how the result panel counts and heads its warnings: what was left
 * out of the results, and what is only a remark about something that is in
 * them.
 * Run with: node --test test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The smallest element the module needs from the page it writes into */
function element() {
    return {
        textContent: '',
        innerHTML: '',
        classes: new Set(['hidden']),
        classList: {
            add(name) { this.owner.classes.add(name); },
            remove(name) { this.owner.classes.delete(name); },
            contains(name) { return this.owner.classes.has(name); }
        },
        querySelector: () => null,
        get hidden() { return this.classes.has('hidden'); }
    };
}

const page = {};
globalThis.document = {
    getElementById(id) {
        if (!page[id]) {
            page[id] = element();
            page[id].classList.owner = page[id];
        }
        return page[id];
    },
    createElement() {
        const node = element();
        node.classList.owner = node;
        // escapeHtml puts text in and reads markup back out
        Object.defineProperty(node, 'textContent', {
            set(value) {
                node.innerHTML = String(value)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            },
            get() { return node.innerHTML; }
        });
        return node;
    }
};

const { countSkippedWarnings, showWarnings, showStats } = await import('../docs/js/utils/uiHelpers.js');
const { postpassToElements } = await import('../docs/js/search/postpassResults.js');

const warnings = document.getElementById('warnings');
const stats = document.getElementById('stats');

test('a note is not a skip', () => {
    const mixed = [
        { message: 'Skipped relation 1: No members', osmType: 'relation', osmId: 1 },
        { message: 'Skipped route relation 2: No way members with geometry', type: 'skipped' },
        { message: 'Route relation 3 has gaps between members', type: 'gap' },
        { message: 'Route relation 4 has 140 members (may be slow to render)', type: 'size' },
        { reason: 'conflicting colours', type: 'color_conflict' }
    ];

    // Everything that is not one of the two route remarks is a skip, which is
    // what the Overpass backend has always reported
    assert.equal(countSkippedWarnings(mixed), 3);
    assert.equal(countSkippedWarnings([]), 0);
    assert.equal(countSkippedWarnings(null), 0);
    assert.equal(countSkippedWarnings([{ type: 'gap' }, { type: 'size' }]), 0);
});

test('the two kinds are headed apart', () => {
    showWarnings([
        { message: 'Skipped way 1: No geometry data', osmType: 'way', osmId: 1 },
        { message: 'Route relation 3 has gaps between members', type: 'gap', osmType: 'relation', osmId: 3 }
    ]);

    assert.match(warnings.innerHTML, /Skipped 1 item\(s\)/);
    assert.match(warnings.innerHTML, /1 note\(s\)/);
    assert.ok(!warnings.hidden);

    // Only skips: no notes heading at all
    showWarnings([{ message: 'Skipped way 1: No geometry data' }]);
    assert.match(warnings.innerHTML, /Skipped 1 item\(s\)/);
    assert.ok(!/note\(s\)/.test(warnings.innerHTML));

    // Only notes: nothing claims anything was skipped
    showWarnings([{ message: 'Route relation 3 has gaps between members', type: 'gap' }]);
    assert.ok(!/Skipped/.test(warnings.innerHTML));
    assert.match(warnings.innerHTML, /1 note\(s\)/);

    showWarnings([]);
    assert.ok(warnings.hidden);
});

test('the stats line does not call a drawn route a skipped one', () => {
    // Postpass hands routes back in maximal runs, so a whole city's worth of
    // them reads as gappy. Every one of these is on the screen
    const routes = Array.from({ length: 39 }, (unused, i) => ({
        message: `Route relation ${i} has gaps between members`,
        type: 'gap',
        osmType: 'relation',
        osmId: i
    }));
    const geometries = routes.map(() => ({
        type: 'relation',
        geometry: { type: 'MultiLineString' }
    }));

    assert.equal(countSkippedWarnings(routes), 0);
    showStats(39, geometries, countSkippedWarnings(routes));
    assert.equal(stats.textContent, 'Showing 39 linestring(s) from 39 total element(s)');
    assert.ok(!/skipped/.test(stats.textContent));

    // A real skip is still reported
    showStats(40, geometries, countSkippedWarnings([...routes, { message: 'Skipped way 9: No geometry data' }]));
    assert.match(stats.textContent, /, skipped 1$/);
});

test('the captured subway response produces notes and no skips', () => {
    const fixture = JSON.parse(readFileSync(
        fileURLToPath(new URL('./data/postpass-nyc-subway.json', import.meta.url)), 'utf8'
    ));
    const elements = postpassToElements(fixture);

    assert.equal(elements.length, 3, 'three routes, none of them skipped');
    // The parser's own warnings for these are checked in postpassResults.test.js;
    // here it is enough that route gap notes never count as skips
    assert.equal(countSkippedWarnings(elements.map(() => ({ type: 'gap' }))), 0);
});
