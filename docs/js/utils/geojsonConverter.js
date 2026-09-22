/**
 * geojsonConverter.js
 * Turns imported GeoJSON into the element shape the Overpass API returns, so
 * an import goes through the same parsing and merging as a query result
 */

/**
 * Convert GeoJSON to Overpass API element format
 * @param {Object} geojson - GeoJSON FeatureCollection or single Feature
 * @returns {Array} Array of Overpass-like element objects
 */
export function convertGeoJsonToElements(geojson) {
    const elements = [];

    // Handle both FeatureCollection and single Feature
    const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];

    features.forEach((feature, index) => {
        if (!feature.geometry || !feature.geometry.coordinates) {
            return; // Skip invalid features
        }

        const geomType = feature.geometry.type;
        const coords = feature.geometry.coordinates;
        const tags = feature.properties || {};
        const id = feature.id || (1000000 + index); // Generate numeric ID

        // Convert based on geometry type
        if (geomType === 'LineString') {
            // Convert to way element
            elements.push({
                type: 'way',
                id: id,
                tags: tags,
                geometry: coords.map(coord => ({ lon: coord[0], lat: coord[1] }))
            });
        } else if (geomType === 'Polygon') {
            // Polygon structure: [[outer], [inner1], [inner2], ...]
            if (coords.length === 1) {
                // Simple polygon without holes - convert to way
                elements.push({
                    type: 'way',
                    id: id,
                    tags: tags,
                    geometry: coords[0].map(coord => ({ lon: coord[0], lat: coord[1] }))
                });
            } else {
                // Polygon with holes - convert to multipolygon relation
                const members = coords.map((ring, ringIndex) => ({
                    type: 'way',
                    ref: `${id}_ring_${ringIndex}`,
                    role: ringIndex === 0 ? 'outer' : 'inner',
                    // All rings belong to the same polygon (index 0)
                    polygonGroup: 0,
                    geometry: ring.map(coord => ({ lon: coord[0], lat: coord[1] }))
                }));

                elements.push({
                    type: 'relation',
                    id: id,
                    tags: { ...tags, type: 'multipolygon' },
                    members: members
                });
            }
        } else if (geomType === 'MultiLineString') {
            // Convert each linestring to a separate way
            coords.forEach((linestring, lsIndex) => {
                elements.push({
                    type: 'way',
                    id: `${id}_${lsIndex}`,
                    tags: tags,
                    geometry: linestring.map(coord => ({ lon: coord[0], lat: coord[1] }))
                });
            });
        } else if (geomType === 'MultiPolygon') {
            // Convert to a multipolygon relation with outer/inner members
            // MultiPolygon structure: [[[outer1], [inner1a], [inner1b]], [[outer2], [inner2]]]
            const members = [];
            let memberIdCounter = 0;

            coords.forEach((polygon, polygonIndex) => {
                // First ring is outer, rest are inners (holes)
                polygon.forEach((ring, ringIndex) => {
                    members.push({
                        type: 'way',
                        ref: `${id}_member_${memberIdCounter++}`,
                        role: ringIndex === 0 ? 'outer' : 'inner',
                        // Track which polygon this ring belongs to (for GeoJSON imports)
                        polygonGroup: polygonIndex,
                        geometry: ring.map(coord => ({ lon: coord[0], lat: coord[1] }))
                    });
                });
            });

            // Create a relation element
            elements.push({
                type: 'relation',
                id: id,
                tags: { ...tags, type: 'multipolygon' },
                members: members
            });
        }
        // Note: Point and MultiPoint are not supported (will be filtered by parseElements)
    });

    return elements;
}
