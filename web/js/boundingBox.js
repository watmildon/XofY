/**
 * boundingBox.js
 * Utilities for calculating bounding boxes of geometries
 */

/**
 * Calculate the bounding box for a single geometry
 * @param {Array} coordinates - Array of [lon, lat] pairs or nested arrays for multipolygons
 * @returns {Object} Bounding box with minLat, maxLat, minLon, maxLon, width, height
 */
export function calculateBounds(coordinates) {
    if (!coordinates || coordinates.length === 0) {
        throw new Error('Cannot calculate bounds for empty coordinates');
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    // Recursively process coordinates to handle nested arrays
    function processCoordinate(coord) {
        if (Array.isArray(coord)) {
            if (typeof coord[0] === 'number' && typeof coord[1] === 'number') {
                // This is a [lon, lat] pair
                const [lon, lat] = coord;
                minLat = Math.min(minLat, lat);
                maxLat = Math.max(maxLat, lat);
                minLon = Math.min(minLon, lon);
                maxLon = Math.max(maxLon, lon);
            } else {
                // This is a nested array, recurse
                coord.forEach(processCoordinate);
            }
        }
    }

    coordinates.forEach(processCoordinate);

    return {
        minLat,
        maxLat,
        minLon,
        maxLon,
        width: maxLon - minLon,
        height: maxLat - minLat
    };
}

/**
 * Calculate the global bounding box encompassing all geometries
 * @param {Array} geometries - Array of GeometryObject
 * @returns {Object} Global bounding box
 */
export function getGlobalBounds(geometries) {
    if (!geometries || geometries.length === 0) {
        throw new Error('Cannot calculate global bounds for empty geometries');
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    geometries.forEach(geom => {
        const bounds = geom.bounds;
        minLat = Math.min(minLat, bounds.minLat);
        maxLat = Math.max(maxLat, bounds.maxLat);
        minLon = Math.min(minLon, bounds.minLon);
        maxLon = Math.max(maxLon, bounds.maxLon);
    });

    return {
        minLat,
        maxLat,
        minLon,
        maxLon,
        width: maxLon - minLon,
        height: maxLat - minLat
    };
}
