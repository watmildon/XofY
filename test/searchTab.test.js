/**
 * searchTab.test.js
 * Tests for the pure decisions the Search tab makes about typed tag text.
 * The tab itself needs a DOM; this covers the part that does not.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isCommittableExpression,
    canCommitTypedText,
    canCommitAsKeyExists
} from '../docs/js/ui/searchTab.js';
import { parseTagExpression, quoteValue } from '../docs/js/search/tagParser.js';

/**
 * Parse text and ask whether it could be searched for
 * @param {string} text - Typed text
 * @returns {boolean} True when it is complete enough
 */
function committable(text) {
    return canCommitTypedText(text);
}

test('complete tag expressions can be committed', () => {
    assert.ok(committable('leisure=park'));
    assert.ok(committable('leisure=park name'), 'a bare key is clear inside a longer expression');
    assert.ok(committable('leisure=track !athletics'));
    assert.ok(committable('name=*'), 'the explicit form of a key-exists filter');
    assert.ok(committable('!athletics'));
    assert.ok(committable('name~^A'));
    assert.ok(committable('name="Golden Gate Bridge"'));
});

test('half-typed filters are not committed', () => {
    // Picking a key from taginfo leaves `leisure=` in the field: the user is
    // still choosing a value, so Execute must stay disabled
    assert.ok(!committable('leisure='));
    assert.ok(!committable('leisure=park amenity='));
    assert.ok(!committable(''));
    assert.ok(!committable('   '));
    assert.ok(!committable('='));
});

test('plain words are left to the feature list', () => {
    // "swimming pool" parses as two key-exists filters, which nobody means
    assert.ok(!committable('swimming pool'));
    assert.ok(!committable('Golden Gate Bridge'));
    assert.ok(isCommittableExpression(parseTagExpression('swimming pool').filters),
        'the parser does produce filters - the Search tab is what declines them');

    // ...and neither does one word. "lighthouse" means the Lighthouse feature,
    // not every object carrying a `lighthouse` key
    assert.ok(!committable('lighthouse'));
    assert.ok(!committable('castle'));
    assert.ok(!committable('name'));
    assert.ok(!committable('swimming_pool'));
    assert.ok(!committable('addr:street'));

    // Spelt as a filter, it is one
    assert.ok(committable('lighthouse=*'));
    assert.ok(committable('name=*'));
});

test('Enter can still fall back to a key-exists search', () => {
    // Only reached when nothing in the suggestion list matched
    assert.ok(canCommitAsKeyExists('lighthouse'));
    assert.ok(canCommitAsKeyExists('addr:street'));
    assert.ok(canCommitAsKeyExists('name=*'));

    assert.ok(!canCommitAsKeyExists('swimming pool'), 'several words are not a key');
    assert.ok(!canCommitAsKeyExists('leisure=park'), 'that is a value filter, not key-exists');
    assert.ok(!canCommitAsKeyExists('leisure='), 'still being typed');
    assert.ok(!canCommitAsKeyExists(''));
});

test('junk input is rejected rather than thrown at the query builder', () => {
    assert.ok(!isCommittableExpression(null));
    assert.ok(!isCommittableExpression([]));
    assert.ok(!isCommittableExpression('leisure=park'));
});

test('a value picked from taginfo splices in as canonical text', () => {
    // What the combobox writes over the value fragment
    assert.equal(quoteValue('swimming_pool'), 'swimming_pool');
    assert.equal(quoteValue('Golden Gate'), '"Golden Gate"');
    assert.equal(quoteValue('say "hi"'), '"say \\"hi\\""');
    assert.equal(quoteValue(''), '""');

    assert.ok(committable('leisure=' + quoteValue('swimming_pool')));
    assert.ok(committable('name=' + quoteValue('Golden Gate')));
    assert.deepEqual(parseTagExpression('name=' + quoteValue('say "hi"')).filters, [
        { key: 'name', op: '=', value: 'say "hi"' }
    ]);
});
