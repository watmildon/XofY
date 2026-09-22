/**
 * geometryParser.js
 * Parses Overpass API results into normalized geometry objects
 * Supports closed ways and multipolygon relations; the merging, area
 * detection and colour handling live in geometry/
 */

import { calculateBounds } from './boundingBox.js';
import { validateAndConvertColor } from './geometry/colorUtils.js';
import { countNodes, isClosed } from './geometry/geometryUtils.js';
import { isArea } from './geometry/areaDetection.js';
import { isPointInPolygon, mergeWaysIntoRings, coalesceOpenWays } from './geometry/wayMerger.js';
import { parseRouteRelation } from './geometry/routeParser.js';

/**
 * Parse elements from Overpass API response
 * @param {Array} elements - Array of OSM elements from Overpass response
 * @param {Object} options - Parsing options: {groupByEnabled, groupByTag}
 * @returns {Object} Object with geometries array and warnings array
 */
export function parseElements(elements, options = {}) {
    const geometries = [];
    const warnings = [];
    const openWays = []; // Collect open ways for coalescing

    // Extract grouping options
    const groupByEnabled = options.groupByEnabled || false;
    const groupByTag = options.groupByTag || 'name';

    if (!elements || elements.length === 0) {
        return { geometries, warnings };
    }

    elements.forEach(element => {
        // Skip nodes
        if (element.type === 'node') {
            const warning = {
                message: `Skipped node ${element.id}: Nodes are not supported (only closed ways)`,
                osmType: 'node',
                osmId: element.id
            };
            console.log('[geometryParser] Adding node warning:', warning);
            warnings.push(warning);
            return;
        }

        // Process relations
        if (element.type === 'relation') {
            // Check for route relations
            if (element.tags?.type === 'route') {
                const routeGeom = parseRouteRelation(element, warnings);
                if (routeGeom) {
                    geometries.push(routeGeom);
                }
                return;
            }

            // Process multipolygon relations
            if (element.tags?.type !== 'multipolygon') {
                const warning = {
                    message: `Skipped relation ${element.id}: Not a multipolygon or route (type="${element.tags?.type || 'undefined'}")`,
                    osmType: 'relation',
                    osmId: element.id
                };
                console.log('[geometryParser] Adding non-multipolygon warning:', warning);
                warnings.push(warning);
                return;
            }

            // Check if relation has members with geometry
            if (!element.members || element.members.length === 0) {
                const warning = {
                    message: `Skipped relation ${element.id}: No members`,
                    osmType: 'relation',
                    osmId: element.id
                };
                console.log('[geometryParser] Adding no-members warning:', warning);
                warnings.push(warning);
                return;
            }

            // Check if members have polygonGroup property (from GeoJSON import)
            // If so, use explicit grouping instead of spatial containment
            const hasPolygonGroups = element.members.some(m => typeof m.polygonGroup === 'number');

            let polygons;

            if (hasPolygonGroups) {
                // GeoJSON import path: use explicit polygon groupings
                // Group members by polygonGroup
                const polygonGroups = new Map();

                element.members.forEach(member => {
                    // Only process way members with geometry
                    if (member.type !== 'way' || !member.geometry || member.geometry.length === 0) {
                        return;
                    }

                    const groupId = member.polygonGroup;
                    if (!polygonGroups.has(groupId)) {
                        polygonGroups.set(groupId, { outers: [], inners: [] });
                    }

                    // Convert to [lon, lat] format
                    const coords = member.geometry.map(coord => [coord.lon, coord.lat]);

                    if (member.role === 'outer') {
                        polygonGroups.get(groupId).outers.push(coords);
                    } else if (member.role === 'inner') {
                        polygonGroups.get(groupId).inners.push(coords);
                    }
                });

                // Validate we have at least one polygon group with an outer
                if (polygonGroups.size === 0 || ![...polygonGroups.values()].some(g => g.outers.length > 0)) {
                    const warning = {
                        message: `Skipped relation ${element.id}: No outer ways`,
                        osmType: 'relation',
                        osmId: element.id
                    };
                    console.log('[geometryParser] Adding no-outer-ways warning:', warning);
                    warnings.push(warning);
                    return;
                }

                // Build polygons from groups
                polygons = [];
                for (const [groupId, group] of polygonGroups) {
                    // Merge outer ways for this group
                    const mergedOuters = mergeWaysIntoRings(group.outers);
                    if (mergedOuters.length === 0) {
                        continue; // Skip invalid groups
                    }

                    // Merge inner ways for this group
                    const mergedInners = group.inners.length > 0 ? mergeWaysIntoRings(group.inners) : [];

                    // Each outer in this group gets all the inners from this group
                    // (For GeoJSON imports, there's typically one outer per group)
                    mergedOuters.forEach(outer => {
                        polygons.push([outer, ...mergedInners]);
                    });
                }

                if (polygons.length === 0) {
                    const warning = {
                        message: `Skipped relation ${element.id}: Outer ways cannot be merged into closed rings`,
                        osmType: 'relation',
                        osmId: element.id
                    };
                    console.log('[geometryParser] Adding merge-failed warning:', warning);
                    warnings.push(warning);
                    return;
                }
            } else {
                // Standard Overpass path: use spatial containment for inner assignment
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
                    const warning = {
                        message: `Skipped relation ${element.id}: No outer ways`,
                        osmType: 'relation',
                        osmId: element.id
                    };
                    console.log('[geometryParser] Adding no-outer-ways warning:', warning);
                    warnings.push(warning);
                    return;
                }

                // Try to merge outer ways into closed rings
                const mergedOuterRings = mergeWaysIntoRings(outerWays);
                if (mergedOuterRings.length === 0) {
                    const warning = {
                        message: `Skipped relation ${element.id}: Outer ways cannot be merged into closed rings`,
                        osmType: 'relation',
                        osmId: element.id
                    };
                    console.log('[geometryParser] Adding merge-failed warning:', warning);
                    warnings.push(warning);
                    return;
                }

                // Try to merge inner ways into closed rings
                const mergedInnerRings = innerWays.length > 0 ? mergeWaysIntoRings(innerWays) : [];
                // Note: If inner ways can't be merged, we'll just ignore them (some relations may have invalid inner ways)

                // Build MultiPolygon structure
                // Assign each inner ring to the outer ring that contains it
                polygons = mergedOuterRings.map(outer => {
                    const innersForThisOuter = mergedInnerRings.filter(inner => {
                        // Test if the first point of the inner ring is inside this outer ring
                        // (We assume inner rings are fully contained, not partially)
                        return isPointInPolygon(inner[0], outer);
                    });
                    return [outer, ...innersForThisOuter];
                });
            }

            // Collect all coordinates for bounds calculation
            const allCoords = polygons.flatMap(polygon => polygon);
            const bounds = calculateBounds(allCoords);

            // Create normalized geometry object
            const geometry = {
                type: 'MultiPolygon',
                coordinates: polygons
            };

            const geometryObject = {
                id: element.id,
                type: 'relation',
                tags: element.tags || {},
                color: validateAndConvertColor(element.tags?.colour),
                geometry: geometry,
                bounds: bounds,
                nodeCount: countNodes(geometry)
            };

            geometries.push(geometryObject);
            return;
        }

        // Process ways
        if (element.type === 'way') {
            // Check if geometry exists
            if (!element.geometry || element.geometry.length === 0) {
                const warning = {
                    message: `Skipped way ${element.id}: No geometry data`,
                    osmType: 'way',
                    osmId: element.id
                };
                console.log('[geometryParser] Adding no-geometry warning:', warning);
                warnings.push(warning);
                return;
            }

            // Convert geometry from {lat, lon} objects to [lon, lat] arrays
            const coordinates = element.geometry.map(coord => [coord.lon, coord.lat]);

            // Check if way is closed or open
            const closed = isClosed(element.geometry);

            if (closed && isArea(element.tags)) {
                // Closed way with area tags - create Polygon
                const bounds = calculateBounds(coordinates);
                const geometry = {
                    type: 'Polygon',
                    coordinates: coordinates
                };
                geometries.push({
                    id: element.id,
                    type: 'way',
                    tags: element.tags || {},
                    color: validateAndConvertColor(element.tags?.colour),
                    geometry: geometry,
                    bounds: bounds,
                    nodeCount: countNodes(geometry)
                });
            } else {
                // Open way OR closed way without area tags - treat as linear feature
                // Collect for coalescing
                openWays.push({
                    id: element.id,
                    tags: element.tags || {},
                    coordinates: coordinates
                });
            }
        }
    });

    // Coalesce open ways into connected components
    if (openWays.length > 0) {
        try {
            const coalesced = coalesceOpenWays(openWays, { groupByEnabled, groupByTag });
            geometries.push(...coalesced.geometries);
            warnings.push(...coalesced.warnings);
        } catch (error) {
            if (error.type === 'NETWORK_TOO_COMPLEX') {
                // Re-throw complexity errors to be handled by UI
                throw error;
            } else {
                // Other errors - warn and fall back to individual linestrings
                console.error('Coalescing error:', error);
                const warning = {
                    message: `Failed to coalesce ${openWays.length} open ways: ${error.message}`,
                    osmType: 'way',
                    osmIds: openWays.map(w => w.id)
                };
                console.log('[geometryParser] Adding coalesce-error warning:', warning);
                warnings.push(warning);

                // Fall back: add each as individual LineString
                openWays.forEach(way => {
                    const geometry = {
                        type: 'LineString',
                        coordinates: way.coordinates
                    };
                    geometries.push({
                        id: way.id,
                        type: 'way',
                        tags: way.tags,
                        color: validateAndConvertColor(way.tags?.colour),
                        geometry: geometry,
                        bounds: calculateBounds(way.coordinates),
                        nodeCount: countNodes(geometry)
                    });
                });
            }
        }
    }

    return { geometries, warnings };
}
