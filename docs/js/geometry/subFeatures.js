/**
 * subFeatures.js
 * Sub-features: the smaller tagged things that sit inside a main feature and
 * give it its detail - parking spaces in a parking lot, bunkers on a golf
 * course, runways on an aerodrome.
 *
 * Two jobs, both pure:
 *
 *   partitionElements  splits a fetched result set into the elements that are
 *                      sub-features (by their tags) and the rest
 *   attachSubFeatures  hangs each parsed sub-feature geometry on every main
 *                      geometry whose polygon encloses it, as `subFeatures`
 *
 * Enclosure is decided on the client rather than in the query, so it works the
 * same on Overpass and on Postpass and needs no area generation on the server.
 * The test is the sub-feature's bounding-box centre against the main feature's
 * rings, holes included: an island is inside a lake's outer ring but sits in a
 * hole of it, and is not "in" the lake.
 *
 * No DOM and no network, so it can be imported in Node for tests.
 */

import { isPointInPolygon } from './wayMerger.js';
import { matchesFilters } from '../search/tagMatcher.js';

/**
 * Split elements into sub-features and main features by their tags.
 *
 * An element is a sub-feature when it matches the sub-feature filters and
 * does not also match the main feature's own filters: with a main feature of
 * `leisure=park` and a sub-feature of `leisure=*`, the parks themselves must
 * stay parks.
 * @param {Array<Object>} elements - Overpass-shaped elements
 * @param {Object} options - What counts as what
 * @param {Array<Object>} options.subFilters - Filters a sub-feature matches
 * @param {Array<Object>} [options.mainFilters] - Filters the main feature
 *     matches, when known (a raw query has none)
 * @returns {{main: Array<Object>, sub: Array<Object>}} The two sets, each in
 *     the order the elements arrived
 */
export function partitionElements(elements, options = {}) {
    const { subFilters, mainFilters } = options;
    const main = [];
    const sub = [];

    if (!Array.isArray(elements)) {
        return { main, sub };
    }
    if (!Array.isArray(subFilters) || subFilters.length === 0) {
        return { main: elements.slice(), sub };
    }

    const hasMainFilters = Array.isArray(mainFilters) && mainFilters.length > 0;

    for (const element of elements) {
        const tags = (element && element.tags) || {};
        const isSub = matchesFilters(tags, subFilters)
            && !(hasMainFilters && matchesFilters(tags, mainFilters));

        (isSub ? sub : main).push(element);
    }

    return { main, sub };
}

/**
 * Whether a point lies inside a parsed geometry's area, holes respected
 * @param {Array<number>} point - [lon, lat]
 * @param {Object} geometry - A parsed Polygon or MultiPolygon; anything else
 *     has no interior
 * @returns {boolean} True when the point is inside
 */
export function isPointInGeometry(point, geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) {
        return false;
    }

    if (geometry.type === 'Polygon') {
        // A parsed Polygon is a single ring of [lon, lat] pairs
        return isPointInPolygon(point, geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon') {
        // Each polygon is [outer, ...inners]
        return geometry.coordinates.some(polygon => (
            Array.isArray(polygon)
            && polygon.length > 0
            && isPointInPolygon(point, polygon[0])
            && !polygon.slice(1).some(inner => isPointInPolygon(point, inner))
        ));
    }

    return false;
}

/**
 * The point that stands for a geometry in the enclosure test
 * @param {Object} geometry - A parsed geometry with bounds
 * @returns {Array<number>|null} [lon, lat], or null without bounds
 */
function representativePoint(geometry) {
    const bounds = geometry && geometry.bounds;

    if (!bounds || !Number.isFinite(bounds.minLon) || !Number.isFinite(bounds.minLat)) {
        return null;
    }
    return [(bounds.minLon + bounds.maxLon) / 2, (bounds.minLat + bounds.maxLat) / 2];
}

/**
 * Whether a bounding box contains a point
 * @param {Object} bounds - {minLat, maxLat, minLon, maxLon}
 * @param {Array<number>} point - [lon, lat]
 * @returns {boolean} True when the point is within the box, edges included
 */
function boundsContain(bounds, point) {
    return point[0] >= bounds.minLon && point[0] <= bounds.maxLon
        && point[1] >= bounds.minLat && point[1] <= bounds.maxLat;
}

/**
 * A uniform grid over the main features' bounding boxes, so that each
 * sub-feature is tested against the few features whose boxes share its cell
 * rather than against all of them. Thousands of lots times tens of thousands
 * of spaces is otherwise a lot of ray casting.
 * @param {Array<Object>} geometries - Main geometries, with bounds
 * @returns {{lookup: Function}} lookup(point) gives candidate indexes
 */
function buildGridIndex(geometries) {
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

    geometries.forEach(geom => {
        const b = geom.bounds;
        minLon = Math.min(minLon, b.minLon);
        minLat = Math.min(minLat, b.minLat);
        maxLon = Math.max(maxLon, b.maxLon);
        maxLat = Math.max(maxLat, b.maxLat);
    });

    // About one feature per cell on average, within reason
    const cellsPerAxis = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(geometries.length))));
    const width = maxLon - minLon;
    const height = maxLat - minLat;
    const cellWidth = width > 0 ? width / cellsPerAxis : 1;
    const cellHeight = height > 0 ? height / cellsPerAxis : 1;

    const column = (lon) => Math.min(cellsPerAxis - 1, Math.max(0, Math.floor((lon - minLon) / cellWidth)));
    const row = (lat) => Math.min(cellsPerAxis - 1, Math.max(0, Math.floor((lat - minLat) / cellHeight)));

    const cells = new Map();

    geometries.forEach((geom, index) => {
        const b = geom.bounds;
        for (let c = column(b.minLon); c <= column(b.maxLon); c++) {
            for (let r = row(b.minLat); r <= row(b.maxLat); r++) {
                const key = c * cellsPerAxis + r;
                if (!cells.has(key)) {
                    cells.set(key, []);
                }
                cells.get(key).push(index);
            }
        }
    });

    return {
        lookup(point) {
            if (point[0] < minLon || point[0] > maxLon || point[1] < minLat || point[1] > maxLat) {
                return [];
            }
            return cells.get(column(point[0]) * cellsPerAxis + row(point[1])) || [];
        }
    };
}

/**
 * Attach each sub-feature to every main feature that encloses it.
 *
 * Every main geometry that has an interior gets a `subFeatures` array, empty
 * or not, so a renderer can read it without checking. A sub-feature enclosed
 * by two nested main features (a lot inside a bigger lot) is attached to both:
 * each cell shows what is inside that outline.
 * @param {Array<Object>} geometries - Parsed main geometries (mutated)
 * @param {Array<Object>} subGeometries - Parsed sub-feature geometries
 * @returns {{attached: number, orphans: number}} How many sub-features found
 *     at least one home, and how many found none
 */
export function attachSubFeatures(geometries, subGeometries) {
    const mains = Array.isArray(geometries) ? geometries : [];
    const subs = Array.isArray(subGeometries) ? subGeometries : [];

    const enclosing = [];
    mains.forEach(geom => {
        const type = geom && geom.geometry && geom.geometry.type;
        if (type === 'Polygon' || type === 'MultiPolygon') {
            geom.subFeatures = [];
            enclosing.push(geom);
        }
    });

    if (enclosing.length === 0 || subs.length === 0) {
        return { attached: 0, orphans: subs.length };
    }

    const index = buildGridIndex(enclosing);
    let attached = 0;

    subs.forEach(sub => {
        const point = representativePoint(sub);
        if (!point) {
            return;
        }

        let found = false;
        for (const candidate of index.lookup(point)) {
            const main = enclosing[candidate];
            if (boundsContain(main.bounds, point) && isPointInGeometry(point, main.geometry)) {
                main.subFeatures.push(sub);
                found = true;
            }
        }
        if (found) {
            attached++;
        }
    });

    return { attached, orphans: subs.length - attached };
}
