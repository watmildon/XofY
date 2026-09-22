/**
 * geometryUtils.js
 * Small helpers shared by the parser: node counts, closure and coordinate keys
 */

/**
 * Count total nodes in a geometry structure
 * @param {Object} geometry - Geometry object with type and coordinates
 * @returns {number} Total count of coordinate points
 */
export function countNodes(geometry) {
    if (!geometry || !geometry.coordinates) {
        return 0;
    }

    const coords = geometry.coordinates;

    switch (geometry.type) {
        case 'LineString':
        case 'Polygon':
            // Simple array of coordinates
            return coords.length;

        case 'MultiLineString':
            // Array of linestrings
            return coords.reduce((sum, linestring) => sum + linestring.length, 0);

        case 'MultiPolygon':
            // Array of polygons, each polygon is array of rings
            return coords.reduce((sum, polygon) => {
                // Each polygon has outer ring + inner rings
                return sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0);
            }, 0);

        default:
            return 0;
    }
}

/**
 * Check if a geometry array represents a closed way
 * @param {Array} geometry - Array of coordinate objects {lat, lon}
 * @returns {boolean} True if the way is closed
 */
export function isClosed(geometry) {
    if (!geometry || geometry.length < 3) {
        return false;
    }

    const first = geometry[0];
    const last = geometry[geometry.length - 1];

    return first.lat === last.lat && first.lon === last.lon;
}

/**
 * Check if two coordinate points are equal
 * @param {Array} coord1 - [lon, lat] coordinate pair
 * @param {Array} coord2 - [lon, lat] coordinate pair
 * @returns {boolean} True if coordinates are equal
 */
export function coordsEqual(coord1, coord2) {
    return coord1[0] === coord2[0] && coord1[1] === coord2[1];
}

/**
 * Convert a coordinate to a stable string key
 * @param {Array} coord - [lon, lat] coordinate pair
 * @returns {string} Coordinate key
 */
export function coordinateToKey(coord) {
    return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}
