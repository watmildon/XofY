/**
 * sharing.test.js
 * Tests for URL parameter encoding/decoding, including the legacy
 * feature/area and q parameters that existing shared links use.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    encodeStateToParams,
    decodeParamsToState,
    buildShareURL,
    encodeAreaRef,
    decodeAreaRef,
    normaliseAreaRef,
    DEFAULT_FILL_COLOR
} from '../docs/js/utils/sharing.js';

const PAGE = 'https://watmildon.github.io/XofY/';

/**
 * Encode a state and return the query string
 * @param {Object} state - State to encode
 * @returns {string} The encoded query string
 */
function encode(state) {
    return encodeStateToParams(state).toString();
}

test('encodes a curated feature and area', () => {
    assert.equal(
        encode({ tab: 'curated', feature: 'parks', area: 'seattle' }),
        'feature=parks&area=seattle'
    );
});

test('decodes a legacy curated link', () => {
    assert.deepEqual(
        decodeParamsToState('?feature=parks&area=seattle&color=ff0000&scale=1&gtag=name'),
        {
            feature: 'parks',
            area: 'seattle',
            fillColor: '#ff0000',
            scaleToggle: true,
            groupByTag: 'name'
        }
    );
});

test('round-trips a legacy curated link with display settings', () => {
    const state = {
        tab: 'curated',
        feature: 'swimming_pools',
        area: 'phoenix',
        fillColor: '#ff8800',
        scaleToggle: true,
        groupByTag: 'ref'
    };

    const decoded = decodeParamsToState(encodeStateToParams(state));

    assert.deepEqual(decoded, {
        feature: 'swimming_pools',
        area: 'phoenix',
        fillColor: '#ff8800',
        scaleToggle: true,
        groupByTag: 'ref'
    });
});

test('round-trips a raw query through the legacy q parameter', () => {
    const query = '[out:json];\nrel(7444);\nmap_to_area->.searchArea;\nwr(area.searchArea)["name"="Métro"];\nout geom;';
    const params = encodeStateToParams({ tab: 'overpass', query });

    assert.ok(params.has('q'));
    assert.equal(decodeParamsToState(params).query, query);
});

test('decodes a q parameter produced by the previous implementation', () => {
    // btoa(encodeURIComponent('[out:json];\nout count;'))
    const legacy = 'JTVCb3V0JTNBanNvbiU1RCUzQiUwQW91dCUyMGNvdW50JTNC';
    assert.equal(decodeParamsToState('q=' + legacy).query, '[out:json];\nout count;');
});

test('ignores a q parameter that cannot be decoded', () => {
    const state = decodeParamsToState('q=!!!not-base64!!!&scale=1');
    assert.deepEqual(state, { scaleToggle: true });
});

test('falls back to the raw query outside the search tab', () => {
    const state = { tab: 'overpass', feature: 'parks', area: 'seattle', query: '[out:json];out count;' };
    const params = encodeStateToParams(state);

    assert.ok(!params.has('feature'));
    assert.ok(params.has('q'));
});

test('omits display settings that are at their defaults', () => {
    assert.equal(
        encode({ tab: 'curated', feature: 'parks', area: 'seattle', fillColor: DEFAULT_FILL_COLOR, scaleToggle: false, groupByTag: '   ' }),
        'feature=parks&area=seattle'
    );
});

test('encodes and decodes free-form area references', () => {
    assert.equal(encodeAreaRef({ osmType: 'relation', osmId: 170100 }), 'r170100');
    assert.equal(encodeAreaRef({ osmType: 'way', osmId: 42 }), 'w42');
    assert.equal(encodeAreaRef({ osmType: 'node', osmId: 42 }), null);
    assert.equal(encodeAreaRef({ osmType: 'relation', osmId: 'abc' }), null);
    assert.equal(encodeAreaRef(null), null);

    assert.deepEqual(decodeAreaRef('r170100'), { osmType: 'relation', osmId: 170100 });
    assert.deepEqual(decodeAreaRef('w42'), { osmType: 'way', osmId: 42 });
    assert.equal(decodeAreaRef('n42'), null);
    assert.equal(decodeAreaRef('r'), null);
    assert.equal(decodeAreaRef('r0'), null);
    assert.equal(decodeAreaRef('r12;out;'), null);
    assert.equal(decodeAreaRef(undefined), null);
});

test('round-trips a fully free-form selection', () => {
    const state = {
        tab: 'curated',
        x: 'highway=primary',
        xLabel: 'Primary Road',
        xElementTypes: 'way',
        y: { osmType: 'relation', osmId: 170100 },
        yLabel: 'Nice, Alpes-Maritimes, France'
    };

    const params = encodeStateToParams(state);
    assert.equal(params.get('x'), 'highway=primary');
    assert.equal(params.get('xl'), 'Primary Road');
    assert.equal(params.get('xt'), 'way');
    assert.equal(params.get('y'), 'r170100');
    assert.equal(params.get('yl'), 'Nice, Alpes-Maritimes, France');

    assert.deepEqual(decodeParamsToState(params), {
        x: 'highway=primary',
        xLabel: 'Primary Road',
        xElementTypes: 'way',
        y: { osmType: 'relation', osmId: 170100 },
        yLabel: 'Nice, Alpes-Maritimes, France'
    });
});

test('round-trips a curated feature with a searched area', () => {
    const state = {
        tab: 'curated',
        feature: 'swimming_pools',
        y: { osmType: 'relation', osmId: 170100 },
        yLabel: 'Nice'
    };

    const params = encodeStateToParams(state);
    assert.equal(params.toString(), 'feature=swimming_pools&y=r170100&yl=Nice');
    assert.deepEqual(decodeParamsToState(params), {
        feature: 'swimming_pools',
        y: { osmType: 'relation', osmId: 170100 },
        yLabel: 'Nice'
    });
});

test('carries element types only when they are not the default', () => {
    // A line-only preset queries ways, which the link has to remember
    const way = encodeStateToParams({
        tab: 'curated', x: 'highway=primary', xLabel: 'Primary Road',
        xElementTypes: 'way', area: 'seattle'
    });
    assert.equal(way.get('xt'), 'way');
    assert.equal(decodeParamsToState(way).xElementTypes, 'way');

    // The default is implied, so it stays out of the URL
    const wr = encodeStateToParams({
        tab: 'curated', x: 'leisure=park', xElementTypes: 'wr', area: 'seattle'
    });
    assert.ok(!wr.has('xt'));
    assert.equal(decodeParamsToState(wr).xElementTypes, undefined);

    // Curated features carry their own element types, so xt is not theirs
    const curated = encodeStateToParams({
        tab: 'curated', feature: 'primary_highways', area: 'seattle', xElementTypes: 'way'
    });
    assert.ok(!curated.has('xt'));
});

test('rejects an element types parameter the query builder would not accept', () => {
    assert.equal(decodeParamsToState('x=leisure%3Dpark&xt=way').xElementTypes, 'way');
    assert.equal(decodeParamsToState('x=leisure%3Dpark&xt=rel').xElementTypes, 'rel');

    for (const bad of ['wr;out;', 'WAY', 'ways', '', 'node);out;//']) {
        const state = decodeParamsToState('x=leisure%3Dpark&xt=' + encodeURIComponent(bad));
        assert.equal(state.xElementTypes, undefined, `xt=${bad} should be ignored`);
        assert.equal(state.x, 'leisure=park');
    }
});

test('round-trips a searched feature with a curated area', () => {
    const state = { tab: 'curated', x: 'man_made=pier', area: 'seattle' };

    const params = encodeStateToParams(state);
    assert.equal(params.toString(), 'x=man_made%3Dpier&area=seattle');
    assert.deepEqual(decodeParamsToState(params), { x: 'man_made=pier', area: 'seattle' });
});

test('keeps awkward characters in the x parameter intact', () => {
    const expression = 'name="say \\"hi\\"" leisure!=park name~^A&B';
    const params = encodeStateToParams({ tab: 'curated', x: expression, area: 'world' });

    assert.equal(decodeParamsToState(params).x, expression);
});

test('needs both halves before using the search parameters', () => {
    assert.equal(encode({ tab: 'curated', feature: 'parks' }), '');
    assert.equal(encode({ tab: 'curated', area: 'seattle' }), '');
    assert.equal(encode({ tab: 'curated', x: 'leisure=park' }), '');
    // An unusable area reference is not enough either
    assert.equal(encode({ tab: 'curated', x: 'leisure=park', y: { osmType: 'node', osmId: 1 } }), '');
    // ...but the raw query still gets shared
    assert.equal(
        encode({ tab: 'curated', feature: 'parks', query: '[out:json];out count;' }),
        'q=' + encodeURIComponent(btoa(encodeURIComponent('[out:json];out count;')))
    );
});

test('ignores an unusable y parameter when decoding', () => {
    assert.deepEqual(decodeParamsToState('x=leisure%3Dpark&y=n1234'), { x: 'leisure=park' });
});

test('returns null when there are no parameters', () => {
    assert.equal(decodeParamsToState(''), null);
    assert.equal(decodeParamsToState('?'), null);
    assert.equal(decodeParamsToState(undefined), null);
});

test('builds a shareable URL that keeps the page path', () => {
    assert.equal(
        buildShareURL({ tab: 'curated', feature: 'parks', area: 'seattle' }, PAGE + '?feature=old&area=old#frag'),
        PAGE + '?feature=parks&area=seattle#frag'
    );
    assert.equal(buildShareURL({}, PAGE), PAGE);
});

test('checks area references that came from storage', () => {
    assert.deepEqual(normaliseAreaRef({ osmType: 'relation', osmId: 170100 }), { osmType: 'relation', osmId: 170100 });
    assert.deepEqual(normaliseAreaRef({ osmType: 'way', osmId: '42' }), { osmType: 'way', osmId: 42 });

    // A node has no area, and these values come from outside the app
    assert.equal(normaliseAreaRef({ osmType: 'node', osmId: 5 }), null);
    assert.equal(normaliseAreaRef({ osmType: 'relation', osmId: 0 }), null);
    assert.equal(normaliseAreaRef({ osmType: 'relation', osmId: '1);out;//' }), null);
    assert.equal(normaliseAreaRef({ osmId: 5 }), null);
    assert.equal(normaliseAreaRef(null), null);
    assert.equal(normaliseAreaRef('r170100'), null);
});
