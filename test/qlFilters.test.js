/**
 * qlFilters.test.js
 * Tests for reading the curated Overpass QL selector strings back as filters,
 * including every string config/features.js actually holds.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQlFilters } from '../docs/js/search/qlFilters.js';
import { formatFilters, escapeQLString } from '../docs/js/search/queryBuilder.js';
import { parseTagExpression } from '../docs/js/search/tagParser.js';
import { FEATURES } from '../docs/js/config/features.js';

test('reads every selector form the curated strings use', () => {
    assert.deepEqual(parseQlFilters('["building"="church"]'), [
        { key: 'building', op: '=', value: 'church' }
    ]);
    assert.deepEqual(parseQlFilters('[athletics=shot_put]'), [
        { key: 'athletics', op: '=', value: 'shot_put' }
    ]);
    assert.deepEqual(parseQlFilters('["name"]'), [{ key: 'name', op: 'exists' }]);
    assert.deepEqual(parseQlFilters('[name]'), [{ key: 'name', op: 'exists' }]);
    assert.deepEqual(parseQlFilters('[!athletics]'), [{ key: 'athletics', op: 'missing' }]);
    assert.deepEqual(parseQlFilters('[!"athletics"]'), [{ key: 'athletics', op: 'missing' }]);
    assert.deepEqual(parseQlFilters('["amenity"!="bar"]'), [
        { key: 'amenity', op: '!=', value: 'bar' }
    ]);
    assert.deepEqual(parseQlFilters('["name"~"^A"]'), [{ key: 'name', op: '~', value: '^A' }]);
    assert.deepEqual(parseQlFilters('["name"!~"^A"]'), [{ key: 'name', op: '!~', value: '^A' }]);

    // Overpass writes a regex match either way round
    assert.deepEqual(parseQlFilters('[name=~"^A"]'), [{ key: 'name', op: '~', value: '^A' }]);
});

test('reads a chain of selectors, however it is spaced', () => {
    const expected = [
        { key: 'leisure', op: '=', value: 'park' },
        { key: 'name', op: 'exists' }
    ];

    assert.deepEqual(parseQlFilters('["leisure"="park"][name]'), expected);
    assert.deepEqual(parseQlFilters('["leisure"="park"] [name]'), expected);
    assert.deepEqual(parseQlFilters('  ["leisure"="park"][name]  '), expected);
    assert.deepEqual(parseQlFilters(''), []);
    assert.deepEqual(parseQlFilters(undefined), []);
});

test('undoes the escaping the query builder writes', () => {
    // Whatever formatFilters can produce must read back as what went in
    const hostile = [
        { key: 'name', op: '=', value: 'a"];out;//' },
        { key: 'note', op: '=', value: 'back\\slash' },
        { key: 'name', op: '~', value: '^A\\.' },
        { key: 'description', op: '=', value: 'two\nlines\tand a\rreturn' },
        { key: 'network', op: '=', value: '都営地下鉄' },
        { key: 'addr:street', op: 'exists' }
    ];

    for (const filter of hostile) {
        assert.deepEqual(parseQlFilters(formatFilters([filter])), [filter], JSON.stringify(filter));
    }

    // And the whole chain at once
    assert.deepEqual(parseQlFilters(formatFilters(hostile)), hostile);
});

test('a value may hold the characters that delimit a selector', () => {
    assert.deepEqual(parseQlFilters(`["name"="${escapeQLString('[bracketed]')}"]`), [
        { key: 'name', op: '=', value: '[bracketed]' }
    ]);
    assert.deepEqual(parseQlFilters('["name"="two words"]'), [
        { key: 'name', op: '=', value: 'two words' }
    ]);
    // A bare value runs to the closing bracket, trailing spaces and all
    assert.deepEqual(parseQlFilters('[name=two words ]'), [
        { key: 'name', op: '=', value: 'two words' }
    ]);
});

test('refuses QL it cannot read rather than dropping a condition', () => {
    assert.throws(() => parseQlFilters('leisure=park'), /Expected "\["/);
    assert.throws(() => parseQlFilters('["leisure"="park"'), /Expected "\]"/);
    assert.throws(() => parseQlFilters('["leisure"="park'), /Unterminated quoted literal/);
    assert.throws(() => parseQlFilters('[]'), /Missing tag key/);
    assert.throws(() => parseQlFilters('[!leisure=park]'), /cannot be combined with an operator/);
    // An area or element selector is not a tag filter
    assert.throws(() => parseQlFilters('(area.searchArea)'), /Expected "\["/);
    assert.throws(() => parseQlFilters('["name"<"5"]'), /Unsupported selector/);
});

test('every curated feature string parses, and means what its QL means', () => {
    let checked = 0;

    for (const [key, feature] of Object.entries(FEATURES)) {
        const filters = parseQlFilters(feature.tags);

        assert.ok(filters.length > 0, `${key} has no filters`);
        for (const filter of filters) {
            assert.ok(filter.key, `${key} has a filter with no key`);
        }

        // Rendering the filters back as QL must describe the same selection.
        // The curated strings are not all canonical ([athletics=shot_put] is
        // written bare), so it is the filters that are compared, not the text
        assert.deepEqual(parseQlFilters(formatFilters(filters)), filters, key);
        checked++;
    }

    assert.equal(checked, Object.keys(FEATURES).length);
    assert.ok(checked > 15, `expected the whole curated list, checked ${checked}`);
});

test('the filters match what the typed-expression parser would produce', () => {
    // The two notations are different, but a filter is a filter: what the SQL
    // builder gets from a curated feature has the same shape as what it gets
    // from something the user typed
    assert.deepEqual(
        parseQlFilters(FEATURES.race_tracks.tags),
        parseTagExpression('leisure=track !athletics').filters
    );
    assert.deepEqual(
        parseQlFilters(FEATURES.parks.tags),
        parseTagExpression('leisure=park name=*').filters
    );
});
