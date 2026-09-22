/**
 * tagParser.test.js
 * Tests for parsing the free-form "X" tag expression.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseTagExpression,
    stringifyFilters,
    normaliseTagExpression,
    classifyInput,
    getTypingContext
} from '../docs/js/search/tagParser.js';
import { formatFilters } from '../docs/js/search/queryBuilder.js';

/**
 * Parse and return only the filters
 * @param {string} input - Expression to parse
 * @returns {Array<Object>} Filters
 */
function filters(input) {
    return parseTagExpression(input).filters;
}

test('parses an empty expression', () => {
    assert.deepEqual(parseTagExpression(''), { filters: [], errors: [] });
    assert.deepEqual(parseTagExpression('   '), { filters: [], errors: [] });
    assert.deepEqual(parseTagExpression(undefined), { filters: [], errors: [] });
    assert.deepEqual(parseTagExpression(null), { filters: [], errors: [] });
});

test('parses key=value', () => {
    assert.deepEqual(filters('leisure=swimming_pool'), [
        { key: 'leisure', op: '=', value: 'swimming_pool' }
    ]);
});

test('parses key existence in all three spellings', () => {
    const expected = [{ key: 'name', op: 'exists' }];
    assert.deepEqual(filters('name'), expected);
    assert.deepEqual(filters('name=*'), expected);
});

test('tolerates spaces around an operator', () => {
    const expected = [{ key: 'leisure', op: '=', value: 'park' }];
    assert.deepEqual(filters('leisure = park'), expected);
    assert.deepEqual(filters('leisure= park'), expected);
    assert.deepEqual(filters('leisure =park'), expected);
    assert.deepEqual(filters('name = "Golden Gate Bridge"'), [
        { key: 'name', op: '=', value: 'Golden Gate Bridge' }
    ]);
    assert.deepEqual(filters('leisure = park and name'), [
        { key: 'leisure', op: '=', value: 'park' },
        { key: 'name', op: 'exists' }
    ]);
});

test('parses key absence', () => {
    const expected = [{ key: 'athletics', op: 'missing' }];
    assert.deepEqual(filters('!athletics'), expected);
    assert.deepEqual(filters('athletics!=*'), expected);
});

test('parses not-equal, regex and negated regex', () => {
    assert.deepEqual(filters('amenity!=parking'), [
        { key: 'amenity', op: '!=', value: 'parking' }
    ]);
    assert.deepEqual(filters('name~^A'), [{ key: 'name', op: '~', value: '^A' }]);
    assert.deepEqual(filters('name=~^A'), [{ key: 'name', op: '~', value: '^A' }]);
    assert.deepEqual(filters('name!~^A'), [{ key: 'name', op: '!~', value: '^A' }]);
});

test('parses several filters joined by whitespace, & or and', () => {
    const expected = [
        { key: 'leisure', op: '=', value: 'park' },
        { key: 'name', op: 'exists' }
    ];
    assert.deepEqual(filters('leisure=park name'), expected);
    assert.deepEqual(filters('leisure=park & name'), expected);
    assert.deepEqual(filters('leisure=park&name'), expected);
    assert.deepEqual(filters('leisure=park and name'), expected);
    assert.deepEqual(filters('leisure=park   AND   name'), expected);
    assert.deepEqual(filters('  leisure=park \t name  '), expected);
});

test('treats a quoted or escaped "and" as a key, not a separator', () => {
    assert.deepEqual(filters('"and"'), [{ key: 'and', op: 'exists' }]);
    assert.deepEqual(filters('\\and'), [{ key: 'and', op: 'exists' }]);
    assert.deepEqual(filters('and=yes'), [{ key: 'and', op: '=', value: 'yes' }]);
    assert.deepEqual(filters('!and'), [{ key: 'and', op: 'missing' }]);

    // The canonical form has to quote it, or re-parsing would drop it
    assert.equal(normaliseTagExpression('"and"'), '"and"=*');
    assert.equal(normaliseTagExpression('leisure=park "and"'), 'leisure=park "and"=*');
    assert.deepEqual(filters(normaliseTagExpression('"and"')), [{ key: 'and', op: 'exists' }]);
});

test('parses quoted values containing spaces and operators', () => {
    assert.deepEqual(filters('name="Golden Gate Bridge"'), [
        { key: 'name', op: '=', value: 'Golden Gate Bridge' }
    ]);
    assert.deepEqual(filters('name="a=b and c"'), [
        { key: 'name', op: '=', value: 'a=b and c' }
    ]);
    assert.deepEqual(filters('"odd key"=value'), [
        { key: 'odd key', op: '=', value: 'value' }
    ]);
});

test('parses escaped quotes and backslashes', () => {
    // name="say \"hi\""
    assert.deepEqual(filters('name="say \\"hi\\""'), [
        { key: 'name', op: '=', value: 'say "hi"' }
    ]);
    // name=back\\slash -> a single literal backslash
    assert.deepEqual(filters('name=back\\\\slash'), [
        { key: 'name', op: '=', value: 'back\\slash' }
    ]);
    // An escaped space keeps one token together
    assert.deepEqual(filters('name=two\\ words'), [
        { key: 'name', op: '=', value: 'two words' }
    ]);
    // ...as does an escaped separator or operator
    assert.deepEqual(filters('name=a\\&b'), [{ key: 'name', op: '=', value: 'a&b' }]);
    assert.deepEqual(filters('name=a\\=b'), [{ key: 'name', op: '=', value: 'a=b' }]);
});

test('keeps regex escapes intact', () => {
    // A backslash only escapes syntax; in front of anything else it is part of
    // the value, so `name~^A\.` stays a regex meaning "starts with A."
    assert.deepEqual(filters('name~^A\\.'), [{ key: 'name', op: '~', value: '^A\\.' }]);

    for (const escape of ['\\.', '\\(', '\\[', '\\+', '\\$', '\\d', '\\s', '\\b']) {
        assert.deepEqual(
            filters('name~x' + escape),
            [{ key: 'name', op: '~', value: 'x' + escape }],
            `lost the escape in ${escape}`
        );
    }

    // Quoting must not change what the escape means either
    assert.deepEqual(filters('name~"^A\\."'), [{ key: 'name', op: '~', value: '^A\\.' }]);
});

test('regex escapes survive into Overpass QL', () => {
    const { filters: parsed } = parseTagExpression('name~^A\\.');
    assert.equal(formatFilters(parsed), '["name"~"^A\\\\."]');
});

test('parses values containing brackets and other QL punctuation', () => {
    assert.deepEqual(filters('name=a]b'), [{ key: 'name', op: '=', value: 'a]b' }]);
    assert.deepEqual(filters('name="[weird];out;"'), [
        { key: 'name', op: '=', value: '[weird];out;' }
    ]);
});

test('parses unicode keys and values', () => {
    assert.deepEqual(filters('network="Métro de Paris"'), [
        { key: 'network', op: '=', value: 'Métro de Paris' }
    ]);
    assert.deepEqual(filters('name:ja=都営地下鉄'), [
        { key: 'name:ja', op: '=', value: '都営地下鉄' }
    ]);
    assert.deepEqual(filters('название'), [{ key: 'название', op: 'exists' }]);
});

test('keeps a literal asterisk when it is quoted', () => {
    assert.deepEqual(filters('name="*"'), [{ key: 'name', op: '=', value: '*' }]);
});

test('keeps an empty value (the user is probably still typing)', () => {
    assert.deepEqual(filters('name='), [{ key: 'name', op: '=', value: '' }]);
    assert.deepEqual(filters('name=""'), [{ key: 'name', op: '=', value: '' }]);
});

test('tolerates an unterminated quote', () => {
    assert.deepEqual(filters('name="Golden Gate'), [
        { key: 'name', op: '=', value: 'Golden Gate' }
    ]);
});

test('tolerates a trailing backslash', () => {
    assert.deepEqual(filters('name=abc\\'), [{ key: 'name', op: '=', value: 'abc\\' }]);
});

test('reports tokens with no key', () => {
    const result = parseTagExpression('=value');
    assert.deepEqual(result.filters, []);
    assert.equal(result.errors.length, 1);

    const trailing = parseTagExpression('=value leisure');
    assert.deepEqual(trailing.filters, [{ key: 'leisure', op: 'exists' }]);
    assert.equal(trailing.errors.length, 1);
});

test('renders a canonical expression', () => {
    // A bare key canonicalises to key=*, so it can never be mistaken for a word
    assert.equal(normaliseTagExpression('leisure=park name'), 'leisure=park name=*');
    assert.equal(normaliseTagExpression('name'), 'name=*');
    assert.equal(normaliseTagExpression('name=*'), 'name=*');
    assert.equal(normaliseTagExpression('leisure = park'), 'leisure=park');
    assert.equal(normaliseTagExpression('leisure=park&name=*'), 'leisure=park name=*');
    assert.equal(normaliseTagExpression('  name   '), 'name=*');
    assert.equal(normaliseTagExpression('!athletics'), '!athletics');
    assert.equal(normaliseTagExpression('name="Golden Gate Bridge"'), 'name="Golden Gate Bridge"');
    assert.equal(normaliseTagExpression('name="*"'), 'name="*"');
    assert.equal(normaliseTagExpression('name='), 'name=""');
    assert.equal(normaliseTagExpression('name~^A'), 'name~"^A"');
});

test('canonical expressions round-trip through the parser', () => {
    const inputs = [
        'leisure=park name=*',
        'name="Golden Gate Bridge"',
        'name="say \\"hi\\""',
        'name=back\\\\slash',
        'name="[weird];out;"',
        'name:ja=都営地下鉄',
        '!athletics leisure=track',
        'name~^A name!~B',
        'name~"^A\\."',
        'name="*"',
        'name=',
        '"and"=*',
        '"odd key"="odd value"'
    ];

    for (const input of inputs) {
        const once = filters(input);
        const canonical = stringifyFilters(once);
        assert.deepEqual(filters(canonical), once, `round-trip failed for ${input}`);
        assert.equal(normaliseTagExpression(canonical), canonical, `not stable for ${input}`);
    }
});

test('classifies input', () => {
    assert.equal(classifyInput('leisure=swimming_pool'), 'tag');
    assert.equal(classifyInput('name~^A'), 'tag');
    assert.equal(classifyInput('!athletics'), 'tag');
    assert.equal(classifyInput('addr:street'), 'tag');
    assert.equal(classifyInput('addr:'), 'tag');
    assert.equal(classifyInput('leisure=park name'), 'tag');
    assert.equal(classifyInput('building'), 'ambiguous');
    assert.equal(classifyInput('swimming_pool'), 'ambiguous');
    assert.equal(classifyInput('swimming pool'), 'words');
    assert.equal(classifyInput('Golden Gate Bridge'), 'words');
    assert.equal(classifyInput(''), 'words');
    assert.equal(classifyInput('   '), 'words');
});

test('reports what is being typed', () => {
    assert.deepEqual(getTypingContext(''), {
        field: 'key', key: null, op: null, partial: '', start: 0, end: 0
    });
    assert.deepEqual(getTypingContext('leis'), {
        field: 'key', key: null, op: null, partial: 'leis', start: 0, end: 4
    });
    assert.deepEqual(getTypingContext('leisure='), {
        field: 'value', key: 'leisure', op: '=', partial: '', start: 8, end: 8
    });
    assert.deepEqual(getTypingContext('leisure=swim'), {
        field: 'value', key: 'leisure', op: '=', partial: 'swim', start: 8, end: 12
    });
    assert.deepEqual(getTypingContext('leisure=park '), {
        field: 'key', key: null, op: null, partial: '', start: 13, end: 13
    });
    assert.deepEqual(getTypingContext('leisure=park na'), {
        field: 'key', key: null, op: null, partial: 'na', start: 13, end: 15
    });
    assert.deepEqual(getTypingContext('name="Golden Ga'), {
        field: 'value', key: 'name', op: '=', partial: 'Golden Ga', start: 5, end: 15
    });
    assert.deepEqual(getTypingContext('!athl'), {
        field: 'key', key: null, op: null, partial: 'athl', start: 1, end: 5
    });
});

test('stays in the value when an operator is followed by a space', () => {
    for (const input of ['leisure =', 'leisure= ', 'leisure = ', 'leisure  =  ']) {
        const context = getTypingContext(input);
        assert.equal(context.field, 'value', `${JSON.stringify(input)} should expect a value`);
        assert.equal(context.key, 'leisure');
        assert.equal(context.op, '=');
        assert.equal(context.partial, '');
        assert.equal(context.start, input.length);
        assert.equal(context.end, input.length);
    }

    assert.deepEqual(getTypingContext('leisure = pa'), {
        field: 'value', key: 'leisure', op: '=', partial: 'pa', start: 10, end: 12
    });
});

test('honours the caret position', () => {
    assert.deepEqual(getTypingContext('leisure=park name=Foo', 12), {
        field: 'value', key: 'leisure', op: '=', partial: 'park', start: 8, end: 12
    });
    assert.deepEqual(getTypingContext('leisure=park', 4), {
        field: 'key', key: null, op: null, partial: 'leis', start: 0, end: 4
    });
    // Out of range positions are clamped
    assert.deepEqual(getTypingContext('leis', 99).end, 4);
    assert.deepEqual(getTypingContext('leis', -5), {
        field: 'key', key: null, op: null, partial: '', start: 0, end: 0
    });
});

test('the reported offsets delimit exactly the fragment being typed', () => {
    const cases = ['leis', 'leisure=swim', 'leisure = pa', '!athl', 'name="Golden Ga', 'a=b c=d'];

    for (const input of cases) {
        const { start, end, partial } = getTypingContext(input);
        // Splicing a pick over [start, end) is what the combobox will do
        const spliced = input.slice(0, start) + 'REPLACED' + input.slice(end);
        assert.equal(spliced, input.slice(0, start) + 'REPLACED', `${input} should end at the caret`);
        assert.ok(input.slice(start, end).includes(partial.replace(/"/g, '')) || partial === '',
            `fragment ${JSON.stringify(input.slice(start, end))} should cover ${JSON.stringify(partial)}`);
    }
});
