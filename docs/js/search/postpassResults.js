/**
 * postpassResults.js
 * Turns a Postpass GeoJSON FeatureCollection into the element shape the
 * Overpass API returns, so that a Postpass result goes through exactly the same
 * parsing, merging and rendering as a query result.
 *
 * Unlike an imported file, these elements are real OSM objects: every one keeps
 * its own type and id, so the detail modal's OSM and JOSM links point at the
 * thing on the screen. That is why utils/geojsonConverter.js is not reused -
 * it invents ids and would move osm_type/osm_id into the tag list.
 *
 * The aim throughout is to produce what `out geom;` would have produced for the
 * same element, as closely as the geometry allows:
 *
 *   - `properties.osm_type` W becomes a way, R a relation. Never the other way
 *     round, even when the geometry would fit: a way element carrying a
 *     relation's id would link to the wrong object.
 *   - A way's polygon or line becomes that way's geometry. The only exception
 *     is a way whose geometry comes back in several pieces (the antimeridian
 *     splits one), which becomes one way per piece with ids `${id}_${i}`.
 *   - A relation's polygons become outer/inner way members carrying
 *     `polygonGroup`, the shape the parser already handles for imports.
 *   - A relation's lines become way members with geometry, in order, which is
 *     what parseRouteRelation draws.
 *   - Rows are deduplicated on (osm_type, osm_id): a boundary relation is in
 *     both the line and the polygon table, and the polygon is the useful one.
 *
 * Pure logic: no DOM and no network, so it can be imported in Node for tests.
 *
 * Data from Postpass (Geofabrik), (c) OpenStreetMap contributors (ODbL).
 */

/** Rank of each geometry kind when the same object comes back twice */
const POLYGON_RANK = 2;
const LINE_RANK = 1;

/**
 * Where a tag list records which of its tags this module invented rather than
 * read from OSM. Anything reading tags for display should skip those.
 */
export const SYNTHESISED_TAGS = '__synthesisedTags';

/**
 * The tag keys in a tag list that were invented rather than mapped
 * @param {Object} tags - A tag list, from anywhere
 * @returns {Array<string>} The invented keys, empty for tags that are all real
 */
export function synthesisedTagKeys(tags) {
    const keys = tags && tags[SYNTHESISED_TAGS];
    return Array.isArray(keys) ? keys : [];
}

/**
 * Convert a GeoJSON coordinate ring or line to the {lat, lon} pairs the parser
 * reads. Postpass serves EPSG:4326, in [lon, lat] order like all GeoJSON.
 * @param {Array<Array<number>>} coordinates - GeoJSON positions
 * @returns {Array<{lat: number, lon: number}>} Parser-shaped geometry
 */
function toGeometry(coordinates) {
    return coordinates.map(coord => ({ lon: coord[0], lat: coord[1] }));
}

/**
 * The element type for a Postpass osm_type
 * @param {string} osmType - 'W' or 'R'
 * @returns {'way'|'relation'|null} The Overpass element type, or null if unknown
 */
function elementType(osmType) {
    const type = String(osmType ?? '').toUpperCase();

    if (type === 'W') {
        return 'way';
    }
    if (type === 'R') {
        return 'relation';
    }
    // Postpass only ever answers W or R for the tables this app reads; a node
    // has no shape to draw
    return null;
}

/**
 * Read a Postpass geometry as a list of polygons (each a list of rings) or a
 * list of lines, whichever it is
 * @param {Object} geometry - GeoJSON geometry
 * @returns {{kind: 'polygon'|'line', parts: Array}|null} The parts, or null when
 *     the geometry is one this app cannot draw
 */
function readParts(geometry) {
    const type = geometry && geometry.type;
    const coordinates = geometry && geometry.coordinates;

    if (!Array.isArray(coordinates) || coordinates.length === 0) {
        return null;
    }

    // Postpass always answers MultiPolygon and MultiLineString, even for a
    // single way; the singular forms are accepted so that a hand-made or
    // future response is not silently dropped
    switch (type) {
        case 'MultiPolygon':
            return { kind: 'polygon', parts: coordinates };
        case 'Polygon':
            return { kind: 'polygon', parts: [coordinates] };
        case 'MultiLineString':
            return { kind: 'line', parts: coordinates };
        case 'LineString':
            return { kind: 'line', parts: [coordinates] };
        default:
            return null;
    }
}

/**
 * The `type` tag a relation must carry for the parser to draw it.
 *
 * osm2pgsql consumes the `type` tag when it decides which table a relation
 * belongs in, so a Postpass row never has one; the geometry says which it was.
 * A relation in the polygon table is a multipolygon or a boundary, and the
 * parser draws both as a multipolygon; a relation of lines is a route.
 * @param {Object} tags - The tags as Postpass sent them
 * @param {'polygon'|'line'} kind - What the geometry is
 * @returns {Object} Tags with a `type` the parser recognises
 */
function withRelationType(tags, kind) {
    if (tags.type) {
        return tags;
    }

    const withType = { ...tags, type: kind === 'polygon' ? 'multipolygon' : 'route' };

    // The parser needs this tag, but it is not something the mapper wrote, so
    // the detail modal should not list it among the object's real tags. The
    // marker is non-enumerable, which keeps it out of Object.keys() and out of
    // any copy anyone makes of the tags
    Object.defineProperty(withType, SYNTHESISED_TAGS, { value: ['type'], enumerable: false });
    return withType;
}

/**
 * Build the elements for one way row
 * @param {number} osmId - The way's OSM id
 * @param {Object} tags - Its tags
 * @param {{kind: string, parts: Array}} geometry - Its parts
 * @returns {Array<Object>} One way element, or one per piece when the geometry
 *     arrived split
 */
function wayElements(osmId, tags, geometry) {
    // A polygon row for a way is one closed ring; a line row is one line
    const pieces = geometry.kind === 'polygon'
        ? geometry.parts.flat()
        : geometry.parts;
    const usable = pieces.filter(piece => Array.isArray(piece) && piece.length > 0);

    if (usable.length === 1) {
        return [{ type: 'way', id: osmId, tags, geometry: toGeometry(usable[0]) }];
    }

    // More than one piece for a single way: the geometry was split (across the
    // antimeridian). The pieces are drawn as separate ways, which is why their
    // ids are marked - `${id}_1` is not an OSM id and must not look like one
    return usable.map((piece, index) => ({
        type: 'way',
        id: `${osmId}_${index}`,
        tags,
        geometry: toGeometry(piece)
    }));
}

/**
 * Build the element for one relation row
 * @param {number} osmId - The relation's OSM id
 * @param {Object} tags - Its tags
 * @param {{kind: string, parts: Array}} geometry - Its parts
 * @returns {Array<Object>} One relation element, or none when it has no usable ring
 */
function relationElements(osmId, tags, geometry) {
    const members = [];

    if (geometry.kind === 'polygon') {
        geometry.parts.forEach((polygon, polygonIndex) => {
            polygon.forEach((ring, ringIndex) => {
                if (!Array.isArray(ring) || ring.length === 0) {
                    return;
                }
                members.push({
                    type: 'way',
                    // The first ring of a GeoJSON polygon is its outline, the
                    // rest are its holes
                    role: ringIndex === 0 ? 'outer' : 'inner',
                    // Which outline each hole belongs to is known here, so the
                    // parser does not have to work it out by containment
                    polygonGroup: polygonIndex,
                    geometry: toGeometry(ring)
                });
            });
        });
    } else {
        geometry.parts.forEach(part => {
            if (!Array.isArray(part) || part.length === 0) {
                return;
            }
            // Postpass merges a route's ways into one line per connected run,
            // so these members are pieces of the route rather than its ways.
            // They carry no ref because no OSM way id is left to put there
            members.push({ type: 'way', role: '', geometry: toGeometry(part) });
        });
    }

    if (members.length === 0) {
        return [];
    }

    return [{
        type: 'relation',
        id: osmId,
        tags: withRelationType(tags, geometry.kind),
        members
    }];
}

/**
 * Drop the warnings that are an artefact of where the geometry came from.
 *
 * Postpass hands back one line per connected run of a route rather than one per
 * member way, and those runs are maximal by construction: if there were no gap
 * between two of them they would be one line. So every multi-part route reads
 * as "gaps between members" to the route parser - true, but said about the
 * backend rather than about the data, and said about every route at once. An
 * Overpass result keeps them, because there the gaps are news.
 * @param {Array<Object>} warnings - Warnings from parseElements
 * @returns {Array<Object>} The warnings worth showing
 */
export function dropRouteGapWarnings(warnings) {
    return Array.isArray(warnings) ? warnings.filter(warning => !warning || warning.type !== 'gap') : [];
}

/**
 * Convert a Postpass GeoJSON response into Overpass-shaped elements
 * @param {Object} featureCollection - The parsed response body
 * @returns {Array<Object>} Elements for geometryParser.parseElements
 */
export function postpassToElements(featureCollection) {
    const features = featureCollection && Array.isArray(featureCollection.features)
        ? featureCollection.features
        : [];
    const seen = new Map();

    for (const feature of features) {
        const properties = (feature && feature.properties) || {};
        const type = elementType(properties.osm_type);
        const osmId = Number(properties.osm_id);
        const parts = readParts(feature && feature.geometry);

        if (!type || !Number.isInteger(osmId) || osmId <= 0 || !parts) {
            continue;
        }

        const tags = properties.tags && typeof properties.tags === 'object' ? properties.tags : {};
        const elements = type === 'way'
            ? wayElements(osmId, tags, parts)
            : relationElements(osmId, tags, parts);

        if (elements.length === 0) {
            continue;
        }

        // A boundary relation has a row in the line table and another in the
        // polygon table. Both are the same object, and the polygon is the one
        // worth drawing
        const key = `${type}/${osmId}`;
        const rank = parts.kind === 'polygon' ? POLYGON_RANK : LINE_RANK;
        const existing = seen.get(key);

        if (existing && existing.rank >= rank) {
            continue;
        }
        // Map.set keeps the position an existing key already had, so replacing
        // a line row with its polygon does not reorder the results
        seen.set(key, { rank, elements });
    }

    return [...seen.values()].flatMap(entry => entry.elements);
}
