/**
 * sqlBuilder.test.js
 * Tests for Postpass SQL generation and escaping. The expected statements are
 * the ones that were timed against the live server: the alternatives the
 * planner would otherwise pick run for minutes, so the shapes are pinned here
 * on purpose.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    escapeSqlString,
    formatSqlFilter,
    formatSqlAnyOf,
    buildPostpassQuery,
    buildSqlGeomQuery,
    buildSqlCountQuery,
    isSupportedSqlElementTypes,
    SUBDIVIDE_VERTICES,
    DEFAULT_TABLE
} from '../docs/js/search/sqlBuilder.js';
import { parseTagExpression } from '../docs/js/search/tagParser.js';

const NICE = { osmType: 'relation', osmId: 170100 };
const CALIFORNIA = { osmType: 'relation', osmId: 165475 };

test('escapes SQL string literals', () => {
    assert.equal(escapeSqlString('plain'), "'plain'");
    assert.equal(escapeSqlString("O'Hare"), "'O''Hare'");
    assert.equal(escapeSqlString("'; DROP TABLE postpass_line; --"), "'''; DROP TABLE postpass_line; --'");
    assert.equal(escapeSqlString('say "hi"'), `'say "hi"'`);
    assert.equal(escapeSqlString('都営地下鉄'), "'都営地下鉄'");
    assert.equal(escapeSqlString('line\nbreak'), "'line\nbreak'");
    assert.equal(escapeSqlString(''), "''");
    assert.equal(escapeSqlString(undefined), "''");

    // A backslash is written as an E'' string with the backslash doubled, so
    // the literal is exactly the input whether or not the server treats
    // backslashes as escapes
    assert.equal(escapeSqlString('back\\slash'), "E'back\\\\slash'");
    assert.equal(escapeSqlString("\\'; DROP TABLE t; --"), "E'\\\\''; DROP TABLE t; --'");
});

test('formats each filter operator', () => {
    assert.equal(
        formatSqlFilter({ key: 'leisure', op: '=', value: 'swimming_pool' }),
        `p.tags @> '{"leisure":"swimming_pool"}'::jsonb`
    );
    assert.equal(
        formatSqlFilter({ key: 'amenity', op: '!=', value: 'bar' }),
        `NOT (p.tags @> '{"amenity":"bar"}'::jsonb)`
    );
    assert.equal(formatSqlFilter({ key: 'name', op: 'exists' }), "p.tags ? 'name'");
    assert.equal(formatSqlFilter({ key: 'athletics', op: 'missing' }), "NOT (p.tags ? 'athletics')");
    assert.equal(formatSqlFilter({ key: 'name', op: '~', value: '^A' }), "p.tags->>'name' ~ '^A'");
    assert.equal(
        formatSqlFilter({ key: 'name', op: '!~', value: '^A' }),
        "COALESCE(p.tags->>'name' !~ '^A', true)"
    );
});

test('rejects broken filters', () => {
    assert.throws(() => formatSqlFilter({ op: '=', value: 'x' }), /missing a key/);
    assert.throws(() => formatSqlFilter({ key: 'a', op: '<' }), /Unsupported tag filter operator/);
    assert.throws(() => formatSqlAnyOf([]), /at least one filter/);
});

/**
 * Read a SQL string literal the way the server will, so that a test can check
 * what a literal actually says rather than how it was written
 * @param {string} literal - A literal as escapeSqlString renders it
 * @returns {string} The text the server would see
 */
function decodeSqlLiteral(literal) {
    const escaping = literal.startsWith("E'");

    assert.ok(literal.endsWith("'"), `not a literal: ${literal}`);
    const body = literal.slice(escaping ? 2 : 1, -1);
    let out = '';

    for (let i = 0; i < body.length; i++) {
        if (body[i] === "'" && body[i + 1] === "'") {
            out += "'";
            i++;
            continue;
        }
        // A lone quote would end the literal here, which is exactly the
        // failure this decoder exists to catch
        assert.notEqual(body[i], "'", `literal ended early: ${literal}`);

        if (escaping && body[i] === '\\') {
            assert.equal(body[i + 1], '\\', `stray escape in ${literal}`);
            out += '\\';
            i++;
            continue;
        }
        out += body[i];
    }

    return out;
}

test('hostile text cannot escape a literal', () => {
    const hostile = [
        `a'b"c\\d;e--f\ng\tह`,
        "'; DROP TABLE postpass_line; --",
        "\\'); DELETE FROM postpass_line; --",
        `' OR 1=1 --`,
        'E\'\\x41\'',
        '{"injected":"json"}',
        '都営地下鉄',
        ''
    ];

    for (const text of hostile) {
        assert.equal(decodeSqlLiteral(escapeSqlString(text)), text, `escaping lost ${text}`);
    }

    const nasty = hostile[0];
    // Through the JSON path...
    const equals = formatSqlFilter({ key: nasty, op: '=', value: nasty });
    // ...and through the plain-literal path
    const exists = formatSqlFilter({ key: nasty, op: 'exists' });
    const regex = formatSqlFilter({ key: 'name', op: '~', value: nasty });

    // The literal in each condition says exactly what was asked for, and
    // nothing the user typed is left outside it
    assert.equal(decodeSqlLiteral(exists.slice('p.tags ? '.length)), nasty);
    assert.equal(decodeSqlLiteral(regex.slice("p.tags->>'name' ~ ".length)), nasty);
    assert.deepEqual(
        JSON.parse(decodeSqlLiteral(equals.slice('p.tags @> '.length, -'::jsonb'.length))),
        { [nasty]: nasty }
    );
});

test('builds the geometry-driven shape that was timed', () => {
    const { filters } = parseTagExpression('leisure=swimming_pool');

    assert.equal(
        buildPostpassQuery({ filters, area: NICE }),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=170100) a
WHERE p.tags @> '{"leisure":"swimming_pool"}'::jsonb
  AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)`
    );
});

test('builds the tag-driven shape that was timed', () => {
    const { filters } = parseTagExpression('attraction=water_slide');

    assert.equal(
        buildPostpassQuery({ filters, area: CALIFORNIA, shape: 'tag' }),
        `WITH a AS MATERIALIZED (
  SELECT ST_Subdivide(geom, 64) AS geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=165475)
SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p
WHERE p.tags @> '{"attraction":"water_slide"}'::jsonb
  AND EXISTS (SELECT 1 FROM a WHERE p.geom && a.geom AND ST_Intersects(p.geom, a.geom))`
    );
    assert.equal(SUBDIVIDE_VERTICES, 64);
});

test('a world search has no boundary clause at all', () => {
    const { filters } = parseTagExpression('building=cathedral');
    const expected = `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p
WHERE p.tags @> '{"building":"cathedral"}'::jsonb`;

    assert.equal(buildPostpassQuery({ filters }), expected);
    assert.equal(buildPostpassQuery({ filters, area: null }), expected);
    assert.equal(buildPostpassQuery({ filters, area: { osmType: 'relation', osmId: null } }), expected);

    // With no boundary there is nothing for the shape to change
    assert.equal(buildPostpassQuery({ filters, shape: 'tag' }), expected);
});

test('element types choose the table and the osm_type condition', () => {
    const { filters } = parseTagExpression('highway=primary name=*');

    assert.match(buildPostpassQuery({ filters, area: NICE }), /FROM postpass_linepolygon p,/);
    assert.ok(!buildPostpassQuery({ filters, area: NICE }).includes('p.osm_type='));

    assert.match(
        buildPostpassQuery({ filters, area: NICE, elementTypes: 'way' }),
        /AND p\.osm_type='W'\n/
    );
    assert.match(
        buildPostpassQuery({ filters, area: NICE, elementTypes: 'rel' }),
        /AND p\.osm_type='R'\n/
    );

    // The osm_type condition sits between the tags and the boundary, so the
    // index-friendly conditions stay first
    assert.equal(
        buildPostpassQuery({ filters, area: NICE, elementTypes: 'way' }),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=170100) a
WHERE p.tags @> '{"highway":"primary"}'::jsonb
  AND p.tags ? 'name'
  AND p.osm_type='W'
  AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)`
    );
});

test('a closed way can be the area, and a node cannot', () => {
    const { filters } = parseTagExpression('leisure=swimming_pool');

    assert.match(
        buildPostpassQuery({ filters, area: { osmType: 'way', osmId: 4567 } }),
        /WHERE osm_type='W' AND osm_id=4567\) a/
    );
    // The spellings Nominatim returns all work, as they do on Overpass
    assert.equal(
        buildPostpassQuery({ filters, area: { osmType: 'R', osmId: 170100 } }),
        buildPostpassQuery({ filters, area: NICE })
    );
});

test('refuses ids, tables and options that could smuggle in SQL', () => {
    const filters = [{ key: 'leisure', op: '=', value: 'park' }];

    assert.throws(() => buildPostpassQuery({ filters, area: { osmType: 'relation', osmId: '1) OR true--' } }), /Invalid OSM id/);
    assert.throws(() => buildPostpassQuery({ filters, area: { osmType: 'relation', osmId: -3 } }), /Invalid OSM id/);
    assert.throws(() => buildPostpassQuery({ filters, area: { osmType: 'relation', osmId: 1.5 } }), /Invalid OSM id/);
    assert.throws(() => buildPostpassQuery({ filters, area: { osmType: 'node', osmId: 5 } }), /Unsupported OSM area type/);
    assert.throws(() => buildPostpassQuery({ filters, elementTypes: 'node' }), /Unsupported element types/);
    assert.throws(() => buildPostpassQuery({ filters, elementTypes: 'nwr' }), /Unsupported element types/);
    assert.throws(() => buildPostpassQuery({ filters, table: 'postpass_point' }), /Unsupported table/);
    assert.throws(() => buildPostpassQuery({ filters, table: 'pg_shadow' }), /Unsupported table/);
    assert.throws(() => buildPostpassQuery({ filters, shape: 'clever' }), /Unsupported query shape/);
    assert.throws(() => buildPostpassQuery({ filters, output: 'meta' }), /Unsupported output mode/);

    assert.ok(isSupportedSqlElementTypes('wr'));
    assert.ok(isSupportedSqlElementTypes('way'));
    assert.ok(isSupportedSqlElementTypes('rel'));
    assert.ok(!isSupportedSqlElementTypes('nwr'));
    assert.ok(!isSupportedSqlElementTypes('node'));
    assert.ok(!isSupportedSqlElementTypes(undefined));
    assert.ok(!isSupportedSqlElementTypes('toString'));
});

test('refuses to read the whole planet with no condition at all', () => {
    // Overpass would reject such a query on its timeout; Postpass would keep
    // working on it long after the client had given up
    assert.throws(() => buildPostpassQuery({ filters: [] }), /at least one tag filter/);
    assert.throws(() => buildPostpassQuery({}), /at least one tag filter/);

    // Bounded by an area it is merely expensive, which is the caller's business
    assert.match(buildPostpassQuery({ filters: [], area: NICE }), /^SELECT p\.osm_type/);
});

test('the count form wraps exactly the query that would run', () => {
    const { filters } = parseTagExpression('leisure=swimming_pool');
    const geom = buildSqlGeomQuery({ filters, area: NICE });

    assert.equal(
        buildSqlCountQuery({ filters, area: NICE }),
        `SELECT count(*) AS total FROM (
${geom}
) t`
    );

    // The tag-driven shape keeps its CTE in front of the counting SELECT,
    // because a statement may only start with one WITH
    const tagShaped = buildSqlGeomQuery({ filters, area: CALIFORNIA, shape: 'tag' });
    const withClause = tagShaped.slice(0, tagShaped.indexOf('SELECT p.osm_type'));
    const inner = tagShaped.slice(withClause.length);

    assert.equal(
        buildSqlCountQuery({ filters, area: CALIFORNIA, shape: 'tag' }),
        `${withClause}SELECT count(*) AS total FROM (
${inner}
) t`
    );
    assert.match(withClause, /^WITH a AS MATERIALIZED \(/);
});

test('an extra condition is ANDed in after the tags', () => {
    const { filters } = parseTagExpression('landuse=flowerbed');

    assert.equal(
        buildPostpassQuery({
            filters,
            area: NICE,
            elementTypes: 'way',
            extraWhere: 'ST_NPoints(p.geom) > 50'
        }),
        `SELECT p.osm_type, p.osm_id, p.tags, p.geom
FROM postpass_linepolygon p,
     (SELECT geom FROM postpass_polygon WHERE osm_type='R' AND osm_id=170100) a
WHERE p.tags @> '{"landuse":"flowerbed"}'::jsonb
  AND p.osm_type='W'
  AND ST_NPoints(p.geom) > 50
  AND p.geom && a.geom AND ST_Intersects(p.geom, a.geom)`
    );

    assert.equal(
        formatSqlAnyOf([
            { key: 'network', op: '=', value: 'Tokyo Metro' },
            { key: 'network', op: '=', value: '都営地下鉄' }
        ]),
        `(p.tags @> '{"network":"Tokyo Metro"}'::jsonb OR p.tags @> '{"network":"都営地下鉄"}'::jsonb)`
    );
});

test('reads the line table when asked, and never the point table', () => {
    const filters = [{ key: 'route', op: '=', value: 'subway' }];

    assert.match(
        buildPostpassQuery({ filters, elementTypes: 'rel', table: 'postpass_line' }),
        /^SELECT p\.osm_type, p\.osm_id, p\.tags, p\.geom\nFROM postpass_line p\n/
    );
    assert.equal(DEFAULT_TABLE, 'postpass_linepolygon');
});

test('the statement is a single SELECT with no trailing semicolon', () => {
    // Postpass wraps what it is given in a subquery and refuses anything else
    const { filters } = parseTagExpression('leisure=park');

    for (const shape of ['geometry', 'tag']) {
        for (const output of ['geom', 'count']) {
            const sql = buildPostpassQuery({ filters, area: NICE, shape, output });
            assert.ok(!sql.trimEnd().endsWith(';'), `${shape}/${output} ended in a semicolon`);
            assert.ok(!sql.includes(';'), `${shape}/${output} holds a statement separator`);
        }
    }
});
