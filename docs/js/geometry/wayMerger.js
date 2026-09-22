/**
 * wayMerger.js
 * Merges multipolygon members into rings, and open ways into connected components
 */

import { calculateBounds } from '../boundingBox.js';
import { validateAndConvertColor } from './colorUtils.js';
import { countNodes, coordsEqual, coordinateToKey } from './geometryUtils.js';

/**
 * Generate a stable ID for a component made of multiple ways
 * @param {Array<number>} wayIds - Array of way IDs
 * @returns {string} Component ID
 */
function generateComponentId(wayIds) {
    return `component_${wayIds.slice().sort((a, b) => a - b).join('_')}`;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 * @param {Array} point - [lon, lat] coordinate to test
 * @param {Array<Array>} ring - Polygon ring as array of [lon, lat] coordinates
 * @returns {boolean} True if point is inside the polygon
 */
export function isPointInPolygon(point, ring) {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        // Ray casting algorithm: count intersections of horizontal ray from point
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

        if (intersect) {
            inside = !inside;
        }
    }

    return inside;
}

/**
 * Aggregate tags from multiple ways into a single tag set for a component
 * @param {Array} ways - Array of way objects with tags
 * @returns {Object} Object with aggregated tags and optional colorConflict info
 */
function aggregateTagsForComponent(ways) {
    // Use tags from the way with a name, or the first way
    const primary = ways.find(w => w.tags && w.tags.name) || ways[0];

    // Check for colour tag conflicts
    const colors = ways
        .map(w => w.tags?.colour)
        .filter(c => c !== undefined && c !== null);

    const uniqueColors = [...new Set(colors)];
    let colorConflict = null;

    if (uniqueColors.length > 1) {
        // Multiple different colors - conflict!
        colorConflict = {
            colors: uniqueColors,
            message: `Color conflict: constituent ways have different colour tags (${uniqueColors.join(', ')})`
        };
    } else if (uniqueColors.length === 1 && colors.length !== ways.length) {
        // Some ways have color, some don't - conflict!
        colorConflict = {
            colors: uniqueColors,
            message: `Color conflict: only ${colors.length} of ${ways.length} constituent ways have colour tags`
        };
    }

    return {
        tags: {
            ...(primary.tags || {}),
            _component_way_count: ways.length,
            _component_way_ids: ways.map(w => w.id).join(',')
        },
        colorConflict
    };
}

/**
 * Try to merge a collection of ways into closed rings
 * @param {Array<Array>} ways - Array of coordinate arrays, each in [lon, lat] format
 * @returns {Array<Array>} Array of closed rings (may be fewer than input if ways were merged)
 */
export function mergeWaysIntoRings(ways) {
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
 * Build a map of ALL coordinates (not just endpoints) to ways that contain them
 * This is used for finding connected components where ways share ANY node
 * @param {Array} ways - Array of way objects with coordinates
 * @returns {Map} Map of coordinate keys to arrays of way IDs
 */
function buildCoordinateMap(ways) {
    const coordMap = new Map();

    ways.forEach(way => {
        // Add ALL coordinates from this way
        way.coordinates.forEach((coord, index) => {
            const key = coordinateToKey(coord);
            if (!coordMap.has(key)) {
                coordMap.set(key, []);
            }
            coordMap.get(key).push({ wayId: way.id, index });
        });
    });

    return coordMap;
}

/**
 * Build a map of just endpoint coordinates to ways
 * This is used for path ordering after components are identified
 * @param {Array} ways - Array of way objects with coordinates
 * @returns {Map} Map of endpoint coordinate keys to connection info
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
            suggestion: 'This set of features is too complex to be easily merged and rendered. Enable "Group by tag" in Settings to group features that share a tag, most commonly "name".'
        };

        throw error;
    }
}

/**
 * Find connected components using BFS
 * Ways are considered connected if they share ANY coordinate (not just endpoints)
 * @param {Array} ways - Array of way objects
 * @returns {Array<Array<number>>} Array of components, each is array of way IDs
 */
function findConnectedComponents(ways) {
    const visited = new Set();
    const components = [];
    const wayMap = new Map(ways.map(w => [w.id, w]));

    // Build a map of ALL coordinates to ways that contain them
    const coordMap = buildCoordinateMap(ways);

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

            // Find all ways connected through ANY shared coordinate
            const currentWay = wayMap.get(currentId);

            // Check ALL coordinates in this way
            currentWay.coordinates.forEach(coord => {
                const nodeKey = coordinateToKey(coord);
                const connections = coordMap.get(nodeKey) || [];

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

    // Strategy depends on topology
    if (terminalNodes.length === 0) {
        // Circular route - no dead ends, merge into single loop
        // mergeCircularRoute returns array of linestrings (merged + any unused)
        return mergeCircularRoute(componentWayIds, wayMap, endpointMap);
    } else if (terminalNodes.length === 2) {
        // Simple chain - merge into single linestring
        // mergeSimpleChain returns array of linestrings (merged + any unused)
        return mergeSimpleChain(componentWayIds, wayMap, endpointMap, terminalNodes);
    } else {
        // Complex branching - extract all maximal paths
        return extractAllPaths(componentWayIds, wayMap, endpointMap, terminalNodes, nodeDegree);
    }
}

/**
 * Merge ways forming a circular route into a single linestring
 * @param {Array<number>} componentWayIds - Array of way IDs in this component
 * @param {Map} wayMap - Map of way ID to way object
 * @param {Map} endpointMap - Endpoint map
 * @returns {Array} Single linestring coordinates
 */
function mergeCircularRoute(componentWayIds, wayMap, endpointMap) {
    const used = new Set();
    const currentWayId = componentWayIds[0];
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
            break;
        }
    }

    // Collect all linestrings (merged path + any unused ways)
    const linestrings = [orderedCoords];

    // Add any unused ways as separate linestrings
    // (These are ways that share coordinates but don't connect via endpoints)
    componentWayIds.forEach(wayId => {
        if (!used.has(wayId)) {
            linestrings.push([...wayMap.get(wayId).coordinates]);
        }
    });

    return linestrings;
}

/**
 * Merge ways forming a simple chain (exactly 2 terminals) into a single linestring
 * @param {Array<number>} componentWayIds - Array of way IDs in this component
 * @param {Map} wayMap - Map of way ID to way object
 * @param {Map} endpointMap - Endpoint map
 * @param {Array<string>} terminalNodes - Array of terminal node keys
 * @returns {Array} Single linestring coordinates
 */
function mergeSimpleChain(componentWayIds, wayMap, endpointMap, terminalNodes) {
    const used = new Set();
    let currentWayId = componentWayIds[0];

    // Start from a terminal node
    for (const wayId of componentWayIds) {
        const way = wayMap.get(wayId);
        const firstNode = coordinateToKey(way.coordinates[0]);
        const lastNode = coordinateToKey(way.coordinates[way.coordinates.length - 1]);

        if (terminalNodes.includes(firstNode) || terminalNodes.includes(lastNode)) {
            currentWayId = wayId;
            // Orient so terminal is at start
            if (terminalNodes.includes(lastNode) && !terminalNodes.includes(firstNode)) {
                // Need to reverse
                way.coordinates = [...way.coordinates].reverse();
            }
            break;
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
            break;
        }
    }

    // Collect all linestrings (merged path + any unused ways)
    const linestrings = [orderedCoords];

    // Add any unused ways as separate linestrings
    componentWayIds.forEach(wayId => {
        if (!used.has(wayId)) {
            linestrings.push([...wayMap.get(wayId).coordinates]);
        }
    });

    return linestrings;
}

/**
 * Extract all maximal paths from a complex branching network
 * @param {Array<number>} componentWayIds - Array of way IDs in this component
 * @param {Map} wayMap - Map of way ID to way object
 * @param {Map} endpointMap - Endpoint map
 * @param {Array<string>} terminalNodes - Array of terminal node keys
 * @param {Map} nodeDegree - Map of node key to degree
 * @returns {Array<Array>} Array of linestring coordinate arrays
 */
function extractAllPaths(componentWayIds, wayMap, endpointMap, terminalNodes, nodeDegree) {
    const paths = [];
    const usedWays = new Set();

    // Build a map of node -> connected ways for this component
    const nodeToWays = new Map();
    componentWayIds.forEach(wayId => {
        const way = wayMap.get(wayId);
        const firstNode = coordinateToKey(way.coordinates[0]);
        const lastNode = coordinateToKey(way.coordinates[way.coordinates.length - 1]);

        if (!nodeToWays.has(firstNode)) nodeToWays.set(firstNode, []);
        if (!nodeToWays.has(lastNode)) nodeToWays.set(lastNode, []);

        nodeToWays.get(firstNode).push({ wayId, isStart: true });
        if (firstNode !== lastNode) {
            nodeToWays.get(lastNode).push({ wayId, isStart: false });
        }
    });

    // Helper function to trace a path from a starting point
    const tracePath = (startWayId, startFromBeginning) => {
        const path = [];
        const way = wayMap.get(startWayId);

        // Initial coordinates (potentially reversed)
        if (startFromBeginning) {
            path.push(...way.coordinates);
        } else {
            path.push(...[...way.coordinates].reverse());
        }
        usedWays.add(startWayId);

        // Keep extending the path
        let canExtend = true;
        while (canExtend) {
            canExtend = false;
            const currentEndNode = coordinateToKey(path[path.length - 1]);
            const connections = nodeToWays.get(currentEndNode) || [];

            for (const conn of connections) {
                if (usedWays.has(conn.wayId)) continue;

                const nextWay = wayMap.get(conn.wayId);
                const nextFirstNode = coordinateToKey(nextWay.coordinates[0]);
                const nextLastNode = coordinateToKey(nextWay.coordinates[nextWay.coordinates.length - 1]);

                // Check if this way connects to our current end
                if (nextFirstNode === currentEndNode) {
                    path.push(...nextWay.coordinates.slice(1));
                    usedWays.add(conn.wayId);
                    canExtend = true;
                    break;
                } else if (nextLastNode === currentEndNode) {
                    const reversed = [...nextWay.coordinates].reverse();
                    path.push(...reversed.slice(1));
                    usedWays.add(conn.wayId);
                    canExtend = true;
                    break;
                }
            }
        }

        return path;
    };

    // Start from each terminal node and trace paths
    terminalNodes.forEach(terminalKey => {
        const wayConnections = nodeToWays.get(terminalKey) || [];

        wayConnections.forEach(conn => {
            if (usedWays.has(conn.wayId)) return;

            // Determine if we start from beginning or end of this way
            const way = wayMap.get(conn.wayId);
            const firstNode = coordinateToKey(way.coordinates[0]);
            const startFromBeginning = (firstNode === terminalKey);

            const path = tracePath(conn.wayId, startFromBeginning);
            if (path.length > 0) {
                paths.push(path);
            }
        });
    });

    // Handle any remaining unused ways (can happen in complex networks with loops)
    componentWayIds.forEach(wayId => {
        if (!usedWays.has(wayId)) {
            const way = wayMap.get(wayId);
            paths.push([...way.coordinates]);
            usedWays.add(wayId);
        }
    });

    return paths.length > 0 ? paths : [wayMap.get(componentWayIds[0]).coordinates];
}

/**
 * Coalesce open ways into connected components
 * @param {Array} openWays - Array of open way objects with id, tags, coordinates
 * @param {Object} options - Options: {groupByEnabled, groupByTag}
 * @returns {Object} Object with geometries and warnings arrays
 */
export function coalesceOpenWays(openWays, options = {}) {
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
            const components = findConnectedComponents(waysInGroup);

            const wayMap = new Map(waysInGroup.map(w => [w.id, w]));

            // Process each component
            components.forEach(componentWayIds => {
                if (componentWayIds.length === 1) {
                    const way = wayMap.get(componentWayIds[0]);
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
                } else {
                    const linestrings = orderComponentIntoPath(componentWayIds, wayMap, endpointMap);
                    const allCoords = linestrings.flat();
                    const componentWays = componentWayIds.map(id => wayMap.get(id));
                    const aggregated = aggregateTagsForComponent(componentWays);

                    // Add color conflict warning if present
                    if (aggregated.colorConflict) {
                        const warning = {
                            type: 'color_conflict',
                            id: generateComponentId(componentWayIds),
                            reason: aggregated.colorConflict.message,
                            osmType: 'component',
                            osmId: generateComponentId(componentWayIds)
                        };
                        console.log('[geometryParser] Adding color-conflict warning (grouped):', warning);
                        warnings.push(warning);
                    }

                    const geometry = {
                        type: linestrings.length === 1 ? 'LineString' : 'MultiLineString',
                        coordinates: linestrings.length === 1 ? linestrings[0] : linestrings
                    };
                    geometries.push({
                        id: generateComponentId(componentWayIds),
                        type: 'component',
                        sourceWayIds: componentWayIds,
                        tags: aggregated.tags,
                        color: aggregated.colorConflict ? null : validateAndConvertColor(aggregated.tags.colour),
                        geometry: geometry,
                        bounds: calculateBounds(allCoords),
                        nodeCount: countNodes(geometry)
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
    const components = findConnectedComponents(openWays);

    // Create way map for quick lookup
    const wayMap = new Map(openWays.map(w => [w.id, w]));

    // Process each component
    components.forEach(componentWayIds => {
        if (componentWayIds.length === 1) {
            // Single way - create simple LineString
            const way = wayMap.get(componentWayIds[0]);
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
        } else {
            // Multiple ways - create component
            const linestrings = orderComponentIntoPath(componentWayIds, wayMap, endpointMap);
            const allCoords = linestrings.flat();

            // Aggregate tags from component ways
            const componentWays = componentWayIds.map(id => wayMap.get(id));
            const aggregated = aggregateTagsForComponent(componentWays);

            // Add color conflict warning if present
            if (aggregated.colorConflict) {
                const warning = {
                    type: 'color_conflict',
                    id: generateComponentId(componentWayIds),
                    reason: aggregated.colorConflict.message,
                    osmType: 'component',
                    osmId: generateComponentId(componentWayIds)
                };
                console.log('[geometryParser] Adding color-conflict warning (ungrouped):', warning);
                warnings.push(warning);
            }

            const geometry = {
                type: linestrings.length === 1 ? 'LineString' : 'MultiLineString',
                coordinates: linestrings.length === 1 ? linestrings[0] : linestrings
            };
            geometries.push({
                id: generateComponentId(componentWayIds),
                type: 'component',
                sourceWayIds: componentWayIds,
                tags: aggregated.tags,
                color: aggregated.colorConflict ? null : validateAndConvertColor(aggregated.tags.colour),
                geometry: geometry,
                bounds: calculateBounds(allCoords),
                nodeCount: countNodes(geometry)
            });
        }
    });

    return { geometries, warnings };
}
