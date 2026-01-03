/**
 * geometryParser.js
 * Parses Overpass API results into normalized geometry objects
 * Supports closed ways and multipolygon relations
 */

import { calculateBounds } from './boundingBox.js';

/**
 * Check if a geometry array represents a closed way
 * @param {Array} geometry - Array of coordinate objects {lat, lon}
 * @returns {boolean} True if the way is closed
 */
function isClosed(geometry) {
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
function coordsEqual(coord1, coord2) {
    return coord1[0] === coord2[0] && coord1[1] === coord2[1];
}

/**
 * Try to merge a collection of ways into closed rings
 * @param {Array<Array>} ways - Array of coordinate arrays, each in [lon, lat] format
 * @returns {Array<Array>} Array of closed rings (may be fewer than input if ways were merged)
 */
function mergeWaysIntoRings(ways) {
    if (ways.length === 0) {
        return [];
    }

    // If only one way, check if it's already closed
    if (ways.length === 1) {
        const way = ways[0];
        if (coordsEqual(way[0], way[way.length - 1])) {
            return [way];
        }
        return [];
    }

    // Copy the ways array to avoid modifying the original
    const remaining = ways.map(w => [...w]);
    const rings = [];

    while (remaining.length > 0) {
        // Start a new ring with the first remaining way
        let current = remaining.shift();
        let merged = true;

        // Keep trying to extend the current ring
        while (merged && remaining.length > 0) {
            merged = false;

            // Check if current ring is already closed
            if (coordsEqual(current[0], current[current.length - 1])) {
                rings.push(current);
                current = null;
                break;
            }

            // Try to find a way that connects to either end of current
            for (let i = 0; i < remaining.length; i++) {
                const candidate = remaining[i];
                const currentStart = current[0];
                const currentEnd = current[current.length - 1];
                const candidateStart = candidate[0];
                const candidateEnd = candidate[candidate.length - 1];

                // Check if candidate connects to end of current
                if (coordsEqual(currentEnd, candidateStart)) {
                    // Append candidate to current (skip first point to avoid duplicate)
                    current = [...current, ...candidate.slice(1)];
                    remaining.splice(i, 1);
                    merged = true;
                    break;
                } else if (coordsEqual(currentEnd, candidateEnd)) {
                    // Append reversed candidate to current
                    current = [...current, ...candidate.slice(0, -1).reverse()];
                    remaining.splice(i, 1);
                    merged = true;
                    break;
                } else if (coordsEqual(currentStart, candidateEnd)) {
                    // Prepend candidate to current (skip last point to avoid duplicate)
                    current = [...candidate.slice(0, -1), ...current];
                    remaining.splice(i, 1);
                    merged = true;
                    break;
                } else if (coordsEqual(currentStart, candidateStart)) {
                    // Prepend reversed candidate to current
                    current = [...candidate.slice(1).reverse(), ...current];
                    remaining.splice(i, 1);
                    merged = true;
                    break;
                }
            }
        }

        // If we exited the loop, check if current ring is closed
        if (current !== null) {
            if (coordsEqual(current[0], current[current.length - 1])) {
                rings.push(current);
            } else {
                // Ring is not closed and can't be extended further
                // This means we have an open linestring that can't be closed
                return [];
            }
        }
    }

    return rings;
}

/**
 * Parse elements from Overpass API response
 * @param {Array} elements - Array of OSM elements from Overpass response
 * @returns {Object} Object with geometries array and warnings array
 */
export function parseElements(elements) {
    const geometries = [];
    const warnings = [];

    if (!elements || elements.length === 0) {
        return { geometries, warnings };
    }

    elements.forEach(element => {
        // Skip nodes
        if (element.type === 'node') {
            warnings.push({
                message: `Skipped node ${element.id}: Nodes are not supported (only closed ways)`,
                osmType: 'node',
                osmId: element.id
            });
            return;
        }

        // Process relations (multipolygons only)
        if (element.type === 'relation') {
            // Only process multipolygon relations
            if (element.tags?.type !== 'multipolygon') {
                warnings.push({
                    message: `Skipped relation ${element.id}: Not a multipolygon (type="${element.tags?.type || 'undefined'}")`,
                    osmType: 'relation',
                    osmId: element.id
                });
                return;
            }

            // Check if relation has members with geometry
            if (!element.members || element.members.length === 0) {
                warnings.push({
                    message: `Skipped relation ${element.id}: No members`,
                    osmType: 'relation',
                    osmId: element.id
                });
                return;
            }

            // Extract outer and inner ways (convert to [lon, lat] format)
            const outerWays = [];
            const innerWays = [];

            element.members.forEach(member => {
                // Only process way members with geometry
                if (member.type !== 'way' || !member.geometry || member.geometry.length === 0) {
                    return;
                }

                // Convert to [lon, lat] format
                const coords = member.geometry.map(coord => [coord.lon, coord.lat]);

                if (member.role === 'outer') {
                    outerWays.push(coords);
                } else if (member.role === 'inner') {
                    innerWays.push(coords);
                }
            });

            // Validate we have at least one outer way
            if (outerWays.length === 0) {
                warnings.push({
                    message: `Skipped relation ${element.id}: No outer ways`,
                    osmType: 'relation',
                    osmId: element.id
                });
                return;
            }

            // Try to merge outer ways into closed rings
            const mergedOuterRings = mergeWaysIntoRings(outerWays);
            if (mergedOuterRings.length === 0) {
                warnings.push({
                    message: `Skipped relation ${element.id}: Outer ways cannot be merged into closed rings`,
                    osmType: 'relation',
                    osmId: element.id
                });
                return;
            }

            // Try to merge inner ways into closed rings
            const mergedInnerRings = innerWays.length > 0 ? mergeWaysIntoRings(innerWays) : [];
            // Note: If inner ways can't be merged, we'll just ignore them (some relations may have invalid inner ways)

            // Build MultiPolygon structure
            // Each merged outer ring becomes a polygon, with all merged inner rings as holes
            // (A more sophisticated approach would match inners to their containing outers)
            const polygons = mergedOuterRings.map(outer => {
                return [outer, ...mergedInnerRings];
            });

            // Calculate bounds across all coordinates
            const allCoords = [...mergedOuterRings, ...mergedInnerRings];
            const bounds = calculateBounds(allCoords);

            // Create normalized geometry object
            const geometryObject = {
                id: element.id,
                type: 'relation',
                tags: element.tags || {},
                geometry: {
                    type: 'MultiPolygon',
                    coordinates: polygons
                },
                bounds: bounds
            };

            geometries.push(geometryObject);
            return;
        }

        // Process ways
        if (element.type === 'way') {
            // Check if geometry exists
            if (!element.geometry || element.geometry.length === 0) {
                warnings.push({
                    message: `Skipped way ${element.id}: No geometry data`,
                    osmType: 'way',
                    osmId: element.id
                });
                return;
            }

            // Check if way is closed
            if (!isClosed(element.geometry)) {
                warnings.push({
                    message: `Skipped way ${element.id}: Not a closed way (open linestring)`,
                    osmType: 'way',
                    osmId: element.id
                });
                return;
            }

            // Convert geometry from {lat, lon} objects to [lon, lat] arrays
            const coordinates = element.geometry.map(coord => [coord.lon, coord.lat]);

            // Calculate bounding box
            const bounds = calculateBounds(coordinates);

            // Create normalized geometry object
            const geometryObject = {
                id: element.id,
                type: 'way',
                tags: element.tags || {},
                geometry: {
                    type: 'Polygon',
                    coordinates: coordinates
                },
                bounds: bounds
            };

            geometries.push(geometryObject);
        }
    });

    return { geometries, warnings };
}
