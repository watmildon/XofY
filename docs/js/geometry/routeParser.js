/**
 * routeParser.js
 * Turns a route relation into one geometry
 */

import { calculateBounds } from '../boundingBox.js';
import { validateAndConvertColor } from './colorUtils.js';
import { countNodes, coordsEqual } from './geometryUtils.js';

/**
 * Parse a route relation into a MultiLineString
 * @param {Object} element - Route relation element
 * @param {Array} warnings - Warnings array to append to
 * @returns {Object|null} Geometry object or null if invalid
 */
export function parseRouteRelation(element, warnings) {
    // Extract way members in order
    const wayMembers = element.members?.filter(m => m.type === 'way' && m.geometry && m.geometry.length > 0) || [];

    if (wayMembers.length === 0) {
        warnings.push({
            message: `Skipped route relation ${element.id}: No way members with geometry`,
            osmType: 'relation',
            osmId: element.id
        });
        return null;
    }

    // Warn if route has many members (performance)
    const ROUTE_MEMBER_WARNING_THRESHOLD = 100;
    if (wayMembers.length > ROUTE_MEMBER_WARNING_THRESHOLD) {
        warnings.push({
            message: `Route relation ${element.id} has ${wayMembers.length} members (may be slow to render)`,
            osmType: 'relation',
            osmId: element.id
        });
    }

    // Convert members to coordinate arrays, preserving order
    const linestrings = wayMembers.map(member =>
        member.geometry.map(coord => [coord.lon, coord.lat])
    );

    // Check for gaps between consecutive ways
    let hasGaps = false;
    for (let i = 0; i < linestrings.length - 1; i++) {
        const currentEnd = linestrings[i][linestrings[i].length - 1];
        const nextStart = linestrings[i + 1][0];
        const nextEnd = linestrings[i + 1][linestrings[i + 1].length - 1];

        // Check if they connect (forward or reverse)
        if (!coordsEqual(currentEnd, nextStart) && !coordsEqual(currentEnd, nextEnd)) {
            hasGaps = true;
            break;
        }
    }

    if (hasGaps) {
        warnings.push({
            message: `Route relation ${element.id} has gaps between members`,
            osmType: 'relation',
            osmId: element.id
        });
    }

    // Calculate bounds across all coordinates
    const allCoords = linestrings.flat();
    const bounds = calculateBounds(allCoords);

    const geometry = {
        type: 'MultiLineString',
        coordinates: linestrings
    };

    return {
        id: element.id,
        type: 'relation',
        tags: element.tags || {},
        color: validateAndConvertColor(element.tags?.colour),
        geometry: geometry,
        bounds: bounds,
        nodeCount: countNodes(geometry)
    };
}
