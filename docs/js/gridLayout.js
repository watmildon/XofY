/**
 * gridLayout.js
 * Manages the grid layout and canvas creation for geometries
 */

/**
 * Preferred tag keys (in order of preference after 'name')
 */
const PREFERRED_TAG_KEYS = ['amenity', 'leisure', 'natural', 'building', 'landuse', 'highway', 'railway', 'waterway'];

/**
 * Maximum number of tags to display
 */
const MAX_TAGS_DISPLAY = 2;

/**
 * Maximum character length for non-name tag values
 */
const MAX_TAG_VALUE_LENGTH = 40;

/**
 * Select tags to display based on preferences
 * @param {Object} tags - OSM tags object
 * @returns {Array<{key: string, value: string}>} Array of tag objects to display
 */
function selectTagsToDisplay(tags) {
    const selectedTags = [];

    // Always add 'name' first if present
    if (tags.name) {
        selectedTags.push({ key: 'name', value: tags.name });
    }

    // If we've reached max tags, return early
    if (selectedTags.length >= MAX_TAGS_DISPLAY) {
        return selectedTags;
    }

    // Look for preferred tags (in order)
    for (const preferredKey of PREFERRED_TAG_KEYS) {
        if (tags[preferredKey]) {
            selectedTags.push({ key: preferredKey, value: tags[preferredKey] });
            break; // Only add the first preferred tag found
        }
    }

    // If we still haven't filled up to max tags, add from remaining tags alphabetically
    if (selectedTags.length < MAX_TAGS_DISPLAY) {
        const remainingKeys = Object.keys(tags)
            .filter(key => key !== 'name' && !PREFERRED_TAG_KEYS.includes(key))
            .sort();

        for (const key of remainingKeys) {
            if (selectedTags.length >= MAX_TAGS_DISPLAY) break;
            selectedTags.push({ key, value: tags[key] });
        }
    }

    return selectedTags;
}

/**
 * Truncate tag value if needed
 * @param {string} key - Tag key
 * @param {string} value - Tag value
 * @returns {string} Potentially truncated value
 */
function formatTagValue(key, value) {
    // Don't truncate 'name' values
    if (key === 'name') {
        return value;
    }

    // Truncate other values if too long
    if (value.length > MAX_TAG_VALUE_LENGTH) {
        return value.substring(0, MAX_TAG_VALUE_LENGTH) + '...';
    }

    return value;
}

/**
 * Create a single geometry item element
 * @param {Object} geom - GeometryObject
 * @param {number} index - Index of the geometry in the full array
 * @returns {HTMLElement} The geometry item element
 */
function createGeometryItem(geom, index) {
    // Create geometry item container
    const item = document.createElement('div');
    item.className = 'geometry-item';
    item.dataset.osmId = geom.id;
    item.dataset.index = index;

    // Create canvas element
    const canvas = document.createElement('canvas');

    // Set canvas size (HiDPI scaling)
    const displaySize = 200; // pixels
    const dpr = window.devicePixelRatio || 1;
    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;
    canvas.style.width = displaySize + 'px';
    canvas.style.height = displaySize + 'px';

    // Store geometry data on canvas for renderer
    canvas.dataset.geometryId = geom.id;
    canvas.dataset.index = index;

    item.appendChild(canvas);

    // Create metadata section
    const meta = document.createElement('div');
    meta.className = 'geometry-meta';

    // Create container for links on same line
    const linksContainer = document.createElement('div');
    linksContainer.className = 'osm-links';

    // Create OSM ID link
    const osmId = document.createElement('a');
    osmId.className = 'osm-id';

    // Handle component vs individual way/relation
    if (geom.type === 'component') {
        // Component - show count of ways
        osmId.textContent = `${geom.sourceWayIds.length} Connected Ways`;
        osmId.href = '#';
        osmId.title = `Component of ways: ${geom.sourceWayIds.join(', ')}`;
        osmId.addEventListener('click', (e) => {
            e.preventDefault();
            // Could show a modal with all constituent way IDs in the future
            alert(`This component contains ${geom.sourceWayIds.length} ways:\n${geom.sourceWayIds.join(', ')}`);
        });
    } else {
        // Individual way or relation
        const osmType = geom.type; // 'way' or 'relation'
        osmId.href = `https://www.openstreetmap.org/${osmType}/${geom.id}`;
        osmId.target = '_blank';
        osmId.rel = 'noopener noreferrer';

        // Capitalize first letter for display
        const displayType = osmType.charAt(0).toUpperCase() + osmType.slice(1);
        osmId.textContent = `OSM ${displayType} ${geom.id}`;
    }

    linksContainer.appendChild(osmId);

    // Create JOSM remote control link
    const josmLink = document.createElement('a');
    josmLink.className = 'josm-link';
    josmLink.textContent = 'JOSM';
    josmLink.title = 'Open in JOSM editor (requires JOSM running with remote control enabled)';

    // Build JOSM URL based on type
    let josmUrl;
    if (geom.type === 'component') {
        // Load all constituent ways
        const objects = geom.sourceWayIds.map(id => `w${id}`).join(',');
        josmUrl = `http://127.0.0.1:8111/load_object?objects=${objects}`;
    } else {
        // Single way or relation
        const osmType = geom.type; // 'way' or 'relation'
        josmUrl = `http://127.0.0.1:8111/load_object?objects=${osmType.charAt(0)}${geom.id}`;
    }

    josmLink.href = josmUrl;

    // Prevent default and handle click to avoid navigation issues
    josmLink.addEventListener('click', (e) => {
        e.preventDefault();
        fetch(josmUrl).catch(() => {
            // Silently fail if JOSM is not running
            // Could optionally show a message to the user
        });
    });

    linksContainer.appendChild(josmLink);
    meta.appendChild(linksContainer);

    // Select and display tags
    const selectedTags = selectTagsToDisplay(geom.tags);

    if (selectedTags.length > 0) {
        selectedTags.forEach(({ key, value }) => {
            const tagDiv = document.createElement('div');
            tagDiv.className = 'osm-tag';

            const formattedValue = formatTagValue(key, value);
            tagDiv.textContent = `${key}: ${formattedValue}`;

            meta.appendChild(tagDiv);
        });
    }

    item.appendChild(meta);

    return item;
}

/**
 * Render a batch of geometries into the grid
 * @param {HTMLElement} container - The container element for the grid
 * @param {Array} geometries - Array of GeometryObject
 * @param {number} startIndex - Start index in the geometries array
 * @param {number} endIndex - End index in the geometries array
 */
function renderBatch(container, geometries, startIndex, endIndex) {
    const fragment = document.createDocumentFragment();
    const slice = geometries.slice(startIndex, endIndex);

    slice.forEach((geom, relativeIndex) => {
        const absoluteIndex = startIndex + relativeIndex;
        const item = createGeometryItem(geom, absoluteIndex);
        fragment.appendChild(item);
    });

    container.appendChild(fragment);
}

/**
 * Create a grid of canvas elements for geometries
 * @param {HTMLElement} container - The container element for the grid
 * @param {Array} geometries - Array of GeometryObject
 * @param {Object} options - Options for grid creation
 * @returns {Object} Grid creation result
 */
export function createGrid(container, geometries, options = {}) {
    const { initialBatch = 50, lazyLoadThreshold = 100 } = options;

    // Clear existing content
    container.innerHTML = '';

    if (!geometries || geometries.length === 0) {
        return { isLazyLoaded: false, renderedCount: 0, totalCount: 0 };
    }

    // Determine if lazy loading should be enabled
    const lazyLoadEnabled = geometries.length >= lazyLoadThreshold;

    if (!lazyLoadEnabled) {
        // Render all geometries for small datasets
        renderBatch(container, geometries, 0, geometries.length);
        return {
            isLazyLoaded: false,
            renderedCount: geometries.length,
            totalCount: geometries.length
        };
    }

    // Lazy loading: render initial batch
    const initialCount = Math.min(initialBatch, geometries.length);
    renderBatch(container, geometries, 0, initialCount);

    return {
        isLazyLoaded: true,
        renderedCount: initialCount,
        totalCount: geometries.length
    };
}

/**
 * Append more items to the grid (for lazy loading)
 * @param {HTMLElement} container - The grid container
 * @param {Array} geometries - Full array of GeometryObject
 * @param {number} startIndex - Start index for new batch
 * @param {number} endIndex - End index for new batch
 */
export function appendBatch(container, geometries, startIndex, endIndex) {
    renderBatch(container, geometries, startIndex, endIndex);
}

/**
 * Get all canvas elements from the grid
 * @param {HTMLElement} container - The grid container
 * @returns {Array<HTMLCanvasElement>} Array of canvas elements
 */
export function getCanvases(container) {
    return Array.from(container.querySelectorAll('canvas'));
}
