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
 * Check if a closed way should be treated as an area (filled polygon)
 * Based on JOSM's area detection logic
 * @param {Object} tags - OSM tags object
 * @returns {boolean} True if the way should be rendered as a filled area
 */
function isArea(tags) {
    if (!tags || Object.keys(tags).length === 0) {
        return false;
    }

    // Explicit area tag
    if (tags.area === 'yes') {
        return true;
    }
    if (tags.area === 'no') {
        return false;
    }

    // Primary area-indicating tag keys
    const areaKeys = [
        'building', 'landuse', 'amenity', 'shop', 'building:part',
        'boundary', 'historic', 'place', 'area:highway'
    ];

    for (const key of areaKeys) {
        if (tags[key]) {
            return true;
        }
    }

    // Specific highway values that indicate areas
    if (tags.highway) {
        const areaHighways = ['rest_area', 'services', 'platform'];
        if (areaHighways.includes(tags.highway)) {
            return true;
        }
    }

    // Railway platforms are areas
    if (tags.railway === 'platform') {
        return true;
    }

    // Aeroway aerodromes are areas
    if (tags.aeroway === 'aerodrome') {
        return true;
    }

    // Leisure - most are areas except specific exceptions
    if (tags.leisure) {
        const linearLeisure = ['picnic_table', 'slipway', 'firepit'];
        if (!linearLeisure.includes(tags.leisure)) {
            return true;
        }
    }

    // Natural features that are areas
    if (tags.natural) {
        const areaNatural = [
            'water', 'wood', 'scrub', 'land', 'grassland', 'heath',
            'rock', 'bare_rock', 'sand', 'beach', 'scree', 'glacier',
            'shingle', 'fell', 'reef', 'stone', 'mud', 'landslide'
        ];
        if (areaNatural.includes(tags.natural)) {
            return true;
        }
    }

    // Default: closed ways without area indicators are linear features
    return false;
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
 * Convert a coordinate to a stable string key
 * @param {Array} coord - [lon, lat] coordinate pair
 * @returns {string} Coordinate key
 */
function coordinateToKey(coord) {
    return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}

/**
 * Generate a stable ID for a component made of multiple ways
 * @param {Array<number>} wayIds - Array of way IDs
 * @returns {string} Component ID
 */
function generateComponentId(wayIds) {
    return `component_${wayIds.slice().sort((a, b) => a - b).join('_')}`;
}

/**
 * Aggregate tags from multiple ways into a single tag set for a component
 * @param {Array} ways - Array of way objects with tags
 * @returns {Object} Aggregated tags
 */
function aggregateTagsForComponent(ways) {
    // Use tags from the way with a name, or the first way
    const primary = ways.find(w => w.tags && w.tags.name) || ways[0];
    return {
        ...(primary.tags || {}),
        _component_way_count: ways.length,
        _component_way_ids: ways.map(w => w.id).join(',')
    };
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
 * Build a map of endpoints to the ways that touch them
 * @param {Array} ways - Array of way objects with id and coordinates
 * @returns {Map<string, Array<{wayId: number, position: string}>>} Endpoint map
 */
function buildEndpointMap(ways) {
    const endpointMap = new Map();

    ways.forEach(way => {
        const firstNode = coordinateToKey(way.coordinates[0]);
        const lastNode = coordinateToKey(way.coordinates[way.coordinates.length - 1]);

        // Add first endpoint
        if (!endpointMap.has(firstNode)) {
            endpointMap.set(firstNode, []);
        }
        endpointMap.get(firstNode).push({ wayId: way.id, position: 'start' });

        // Add last endpoint (only if different from first - avoid duplicates for closed ways)
        if (firstNode !== lastNode) {
            if (!endpointMap.has(lastNode)) {
                endpointMap.set(lastNode, []);
            }
            endpointMap.get(lastNode).push({ wayId: way.id, position: 'end' });
        }
    });

    return endpointMap;
}

/**
 * Detect if the network is too complex (indicates a road network)
 * Throws an error if any node has more than 3 way connections
 * @param {Map} endpointMap - Map of coordinate keys to way connections
 * @param {number} wayCount - Total number of ways being processed
 * @throws {Error} If network is too complex
 */
function detectComplexity(endpointMap, wayCount) {
    const WAY_COUNT_THRESHOLD = 1000;

    // Skip complexity check if there are fewer than 1000 ways
    if (wayCount < WAY_COUNT_THRESHOLD) {
        return;
    }

    const complexNodes = [];
    const COMPLEXITY_THRESHOLD = 3;

    endpointMap.forEach((connections, nodeKey) => {
        if (connections.length > COMPLEXITY_THRESHOLD) {
            // Parse coordinates from key for error reporting
            const [lon, lat] = nodeKey.split(',').map(Number);
            complexNodes.push({
                coords: [lon, lat],
                connectionCount: connections.length,
                wayIds: connections.map(c => c.wayId)
            });
        }
    });

    if (complexNodes.length > 0) {
        // Sort by connection count (most complex first)
        complexNodes.sort((a, b) => b.connectionCount - a.connectionCount);

        // Create detailed error
        const error = new Error(`Network too complex: Found ${complexNodes.length} node(s) with more than ${COMPLEXITY_THRESHOLD} connections`);
        error.type = 'NETWORK_TOO_COMPLEX';
        error.details = {
            complexNodeCount: complexNodes.length,
            threshold: COMPLEXITY_THRESHOLD,
            topComplexNodes: complexNodes.slice(0, 5), // Top 5 most complex
            suggestion: 'This appears to be a road network. Try querying more specific linear features like trails, waterways, or power lines.'
        };

        throw error;
    }
}

/**
 * Find connected components using BFS
 * @param {Array} ways - Array of way objects
 * @param {Map} endpointMap - Map of coordinate keys to way connections
 * @returns {Array<Array<number>>} Array of components, each is array of way IDs
 */
function findConnectedComponents(ways, endpointMap) {
    const visited = new Set();
    const components = [];
    const wayMap = new Map(ways.map(w => [w.id, w]));

    ways.forEach(way => {
        if (visited.has(way.id)) {
            return;
        }

        // Start a new component with BFS
        const component = [];
        const queue = [way.id];

        while (queue.length > 0) {
            const currentId = queue.shift();

            if (visited.has(currentId)) {
                continue;
            }

            visited.add(currentId);
            component.push(currentId);

            // Find all ways connected through shared endpoints
            const currentWay = wayMap.get(currentId);
            const firstNode = coordinateToKey(currentWay.coordinates[0]);
            const lastNode = coordinateToKey(currentWay.coordinates[currentWay.coordinates.length - 1]);

            // Check both endpoints
            [firstNode, lastNode].forEach(nodeKey => {
                const connections = endpointMap.get(nodeKey) || [];
                connections.forEach(conn => {
                    if (!visited.has(conn.wayId)) {
                        queue.push(conn.wayId);
                    }
                });
            });
        }

        components.push(component);
    });

    return components;
}

/**
 * Order ways within a component into a continuous path
 * Handles linear chains, circular routes, and simple branching
 * @param {Array<number>} componentWayIds - Array of way IDs in this component
 * @param {Map} wayMap - Map of way ID to way object
 * @param {Map} endpointMap - Endpoint map
 * @returns {Array<Array>} Array of coordinate arrays (for MultiLineString)
 */
function orderComponentIntoPath(componentWayIds, wayMap, endpointMap) {
    // Single way - just return its coordinates
    if (componentWayIds.length === 1) {
        return [wayMap.get(componentWayIds[0]).coordinates];
    }

    // Find terminal nodes (degree 1) - these are potential start/end points
    const nodeDegree = new Map();
    componentWayIds.forEach(wayId => {
        const way = wayMap.get(wayId);
        const firstNode = coordinateToKey(way.coordinates[0]);
        const lastNode = coordinateToKey(way.coordinates[way.coordinates.length - 1]);

        nodeDegree.set(firstNode, (nodeDegree.get(firstNode) || 0) + 1);
        if (firstNode !== lastNode) {
            nodeDegree.set(lastNode, (nodeDegree.get(lastNode) || 0) + 1);
        }
    });

    // Find terminal nodes (degree 1)
    const terminalNodes = [];
    nodeDegree.forEach((degree, nodeKey) => {
        if (degree === 1) {
            terminalNodes.push(nodeKey);
        }
    });

    // If we have branching (more than 2 terminals or any nodes with degree 3),
    // return each way as a separate linestring
    if (terminalNodes.length > 2 || Array.from(nodeDegree.values()).some(d => d === 3)) {
        return componentWayIds.map(wayId => wayMap.get(wayId).coordinates);
    }

    // Linear chain or circular route - merge into single linestring
    const used = new Set();
    let currentWayId = componentWayIds[0];

    // If we have terminals, start from one
    if (terminalNodes.length > 0) {
        // Find a way that has a terminal node
        for (const wayId of componentWayIds) {
            const way = wayMap.get(wayId);
            const firstNode = coordinateToKey(way.coordinates[0]);
            const lastNode = coordinateToKey(way.coordinates[way.coordinates.length - 1]);

            if (terminalNodes.includes(firstNode) || terminalNodes.includes(lastNode)) {
                currentWayId = wayId;
                // Orient so terminal is at start
                if (terminalNodes.includes(lastNode) && !terminalNodes.includes(firstNode)) {
                    // Need to reverse
                    const way = wayMap.get(wayId);
                    way.coordinates = [...way.coordinates].reverse();
                }
                break;
            }
        }
    }

    const orderedCoords = [...wayMap.get(currentWayId).coordinates];
    used.add(currentWayId);

    // Walk through the component
    while (used.size < componentWayIds.length) {
        const currentEndNode = coordinateToKey(orderedCoords[orderedCoords.length - 1]);
        const connections = endpointMap.get(currentEndNode) || [];

        // Find next unused way
        let found = false;
        for (const conn of connections) {
            if (!used.has(conn.wayId) && componentWayIds.includes(conn.wayId)) {
                const nextWay = wayMap.get(conn.wayId);
                const nextFirstNode = coordinateToKey(nextWay.coordinates[0]);
                const nextLastNode = coordinateToKey(nextWay.coordinates[nextWay.coordinates.length - 1]);

                // Orient the way correctly
                if (nextFirstNode === currentEndNode) {
                    // Append normally (skip first coord to avoid duplicate)
                    orderedCoords.push(...nextWay.coordinates.slice(1));
                } else if (nextLastNode === currentEndNode) {
                    // Append reversed
                    const reversed = [...nextWay.coordinates].reverse();
                    orderedCoords.push(...reversed.slice(1));
                }

                used.add(conn.wayId);
                found = true;
                break;
            }
        }

        if (!found) {
            // Can't extend further - might have disconnected segments
            break;
        }
    }

    return [orderedCoords];
}

/**
 * Coalesce open ways into connected components
 * @param {Array} openWays - Array of open way objects with id, tags, coordinates
 * @param {Object} options - Options: {groupByEnabled, groupByTag}
 * @returns {Object} Object with geometries and warnings arrays
 */
function coalesceOpenWays(openWays, options = {}) {
    const geometries = [];
    const warnings = [];
    const { groupByEnabled = false, groupByTag = 'name' } = options;

    if (openWays.length === 0) {
        return { geometries, warnings };
    }

    // If grouping is enabled, partition ways by tag value
    if (groupByEnabled) {
        // Group ways by tag value
        const waysByTagValue = new Map();

        openWays.forEach(way => {
            const tagValue = way.tags?.[groupByTag] || '';
            if (!waysByTagValue.has(tagValue)) {
                waysByTagValue.set(tagValue, []);
            }
            waysByTagValue.get(tagValue).push(way);
        });

        // Process each tag value group separately
        waysByTagValue.forEach((waysInGroup, tagValue) => {
            // Build endpoint map for this group only
            const endpointMap = buildEndpointMap(waysInGroup);

            // Skip complexity detection when grouping is enabled
            // (user choice to group road networks)

            // Find connected components within this group
            const components = findConnectedComponents(waysInGroup, endpointMap);
            const wayMap = new Map(waysInGroup.map(w => [w.id, w]));

            // Process each component
            components.forEach(componentWayIds => {
                if (componentWayIds.length === 1) {
                    const way = wayMap.get(componentWayIds[0]);
                    geometries.push({
                        id: way.id,
                        type: 'way',
                        tags: way.tags,
                        geometry: {
                            type: 'LineString',
                            coordinates: way.coordinates
                        },
                        bounds: calculateBounds(way.coordinates)
                    });
                } else {
                    const linestrings = orderComponentIntoPath(componentWayIds, wayMap, endpointMap);
                    const allCoords = linestrings.flat();
                    const componentWays = componentWayIds.map(id => wayMap.get(id));
                    const aggregatedTags = aggregateTagsForComponent(componentWays);

                    geometries.push({
                        id: generateComponentId(componentWayIds),
                        type: 'component',
                        sourceWayIds: componentWayIds,
                        tags: aggregatedTags,
                        geometry: {
                            type: linestrings.length === 1 ? 'LineString' : 'MultiLineString',
                            coordinates: linestrings.length === 1 ? linestrings[0] : linestrings
                        },
                        bounds: calculateBounds(allCoords)
                    });
                }
            });
        });

        return { geometries, warnings };
    }

    // Original ungrouped behavior
    // Build endpoint map
    const endpointMap = buildEndpointMap(openWays);

    // Detect complexity (throws if too complex)
    detectComplexity(endpointMap, openWays.length);

    // Find connected components
    const components = findConnectedComponents(openWays, endpointMap);

    // Create way map for quick lookup
    const wayMap = new Map(openWays.map(w => [w.id, w]));

    // Process each component
    components.forEach(componentWayIds => {
        if (componentWayIds.length === 1) {
            // Single way - create simple LineString
            const way = wayMap.get(componentWayIds[0]);
            geometries.push({
                id: way.id,
                type: 'way',
                tags: way.tags,
                geometry: {
                    type: 'LineString',
                    coordinates: way.coordinates
                },
                bounds: calculateBounds(way.coordinates)
            });
        } else {
            // Multiple ways - create component
            const linestrings = orderComponentIntoPath(componentWayIds, wayMap, endpointMap);
            const allCoords = linestrings.flat();

            // Aggregate tags from component ways
            const componentWays = componentWayIds.map(id => wayMap.get(id));
            const aggregatedTags = aggregateTagsForComponent(componentWays);

            geometries.push({
                id: generateComponentId(componentWayIds),
                type: 'component',
                sourceWayIds: componentWayIds,
                tags: aggregatedTags,
                geometry: {
                    type: linestrings.length === 1 ? 'LineString' : 'MultiLineString',
                    coordinates: linestrings.length === 1 ? linestrings[0] : linestrings
                },
                bounds: calculateBounds(allCoords)
            });
        }
    });

    return { geometries, warnings };
}

/**
 * Parse a route relation into a MultiLineString
 * @param {Object} element - Route relation element
 * @param {Array} warnings - Warnings array to append to
 * @returns {Object|null} Geometry object or null if invalid
 */
function parseRouteRelation(element, warnings) {
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

    return {
        id: element.id,
        type: 'relation',
        tags: element.tags || {},
        geometry: {
            type: 'MultiLineString',
            coordinates: linestrings
        },
        bounds: bounds
    };
}

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
            warnings.push({
                message: `Skipped node ${element.id}: Nodes are not supported (only closed ways)`,
                osmType: 'node',
                osmId: element.id
            });
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
                warnings.push({
                    message: `Skipped relation ${element.id}: Not a multipolygon or route (type="${element.tags?.type || 'undefined'}")`,
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

            // Convert geometry from {lat, lon} objects to [lon, lat] arrays
            const coordinates = element.geometry.map(coord => [coord.lon, coord.lat]);

            // Check if way is closed or open
            const closed = isClosed(element.geometry);

            if (closed && isArea(element.tags)) {
                // Closed way with area tags - create Polygon
                const bounds = calculateBounds(coordinates);
                geometries.push({
                    id: element.id,
                    type: 'way',
                    tags: element.tags || {},
                    geometry: {
                        type: 'Polygon',
                        coordinates: coordinates
                    },
                    bounds: bounds
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
                warnings.push({
                    message: `Failed to coalesce ${openWays.length} open ways: ${error.message}`,
                    osmType: 'way',
                    osmIds: openWays.map(w => w.id)
                });

                // Fall back: add each as individual LineString
                openWays.forEach(way => {
                    geometries.push({
                        id: way.id,
                        type: 'way',
                        tags: way.tags,
                        geometry: {
                            type: 'LineString',
                            coordinates: way.coordinates
                        },
                        bounds: calculateBounds(way.coordinates)
                    });
                });
            }
        }
    }

    return { geometries, warnings };
}
