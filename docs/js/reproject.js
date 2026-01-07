/**
 * reproject.js
 * Reprojects geometries onto EPSG:3857.
 */

/**
 * Reproject a point to EPSG:3857. It is not the real 3857 though,
 * because we do not multiply by the Earth radius. Since we're rescaling
 * everything, the scale does not matter.
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @returns {Object} {x, y} reprojected coordinates
 */
function to3857(lon, lat) {
    // We do not multiply by earth radius, because the exact scale does not matter.
    const x = lon * (Math.PI / 180);
    const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));

    return { x, y };
}

/**
 * Reprojects bounds object.
 * @param {Object} bounds - Bounding box {minLat, maxLat, minLon, maxLon, width, height}
 * @returns {Object} {minLat, maxLat, minLon, maxLon, width, height} same box but in 3857.
 */
export function reprojectBounds(bounds) {
    const min = to3857(bounds.minLon, bounds.minLat);
    const max = to3857(bounds.maxLon, bounds.maxLat);

    return {
        minLon: min.x,
        minLat: min.y,
        maxLon: max.x,
        maxLat: max.y,
        width: max.x - min.x,
        height: max.y - min.y,
    };
}

/**
 * Assumes a geometry is a list or a list of lists of tuples, and reprojects
 * all coordinates into EPSG:3857 to render them properly (keeping angles).
 * @param {Array<Array>} geometry - some geometry.
 * @return {Array<Array>} same geometry.
 */
export function reprojectGeometry(geometry) {
    // We obviously need to process arrays recursively
    function processCoordinates(coord) {
        if (Array.isArray(coord)) {
            if (typeof coord[0] === 'number' && typeof coord[1] === 'number') {
                // This is a [lon, lat] pair
                const p = to3857(coord[0], coord[1])
                return [p.x, p.y];
            } else {
                // This is a nested array, recurse
                return coord.map((c) => processCoordinates(c));
            }
        }
    }

    return processCoordinates(geometry);
}

