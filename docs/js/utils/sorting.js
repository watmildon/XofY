/**
 * sorting.js
 * Orders parsed geometries for the grid
 */

/**
 * Sort geometries based on the selected sort order
 * @param {Array} geometries - Array of geometry objects
 * @param {string} sortBy - Sort option ('default', 'nodes-asc', 'nodes-desc', 'size-asc', 'size-desc')
 * @returns {Array} Sorted array of geometries
 */
export function sortGeometries(geometries, sortBy) {
    // Create a copy to avoid mutating original during sort
    const sorted = [...geometries];

    if (sortBy === 'default') {
        // No sorting - return as is
        return sorted;
    }

    // Helper function to calculate area (handle degenerate cases like vertical/horizontal lines)
    const getArea = (geom) => {
        const width = geom.bounds.width || 0;
        const height = geom.bounds.height || 0;
        // For degenerate cases (width or height is 0), use the max dimension
        if (width === 0 && height === 0) return 0;
        if (width === 0) return height;
        if (height === 0) return width;
        return width * height;
    };

    switch (sortBy) {
        case 'nodes-asc':
            sorted.sort((a, b) => (a.nodeCount || 0) - (b.nodeCount || 0));
            break;
        case 'nodes-desc':
            sorted.sort((a, b) => (b.nodeCount || 0) - (a.nodeCount || 0));
            break;
        case 'size-asc':
            sorted.sort((a, b) => getArea(a) - getArea(b));
            break;
        case 'size-desc':
            sorted.sort((a, b) => getArea(b) - getArea(a));
            break;
        default:
            // Unknown sort - return unsorted
            break;
    }

    return sorted;
}
