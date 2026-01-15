/**
 * gridLayout.js
 * Manages the grid layout and canvas creation for geometries
 */

/**
 * Preferred tag keys (in order of preference after 'name')
 */
const PREFERRED_TAG_KEYS = ['amenity', 'leisure', 'natural', 'building', 'landuse', 'highway', 'railway', 'waterway'];

/**
 * Sort tag keys alphabetically, but put internal tags (starting with _) at the end
 * @param {string[]} keys - Array of tag keys to sort
 * @returns {string[]} Sorted array with internal tags at the end
 */
export function sortTagKeys(keys) {
    const osmTags = keys.filter(k => !k.startsWith('_')).sort();
    const internalTags = keys.filter(k => k.startsWith('_')).sort();
    return [...osmTags, ...internalTags];
}

/**
 * Maximum number of tags to display
 */
const MAX_TAGS_DISPLAY = 2;

/**
 * Maximum character length for non-name tag values
 */
const MAX_TAG_VALUE_LENGTH = 40;

/**
 * Calculate the centroid of a bounding box
 * @param {Object} bounds - Bounding box {minLat, maxLat, minLon, maxLon}
 * @returns {Object} {lat, lon} centroid coordinates
 */
function calculateCentroid(bounds) {
    return {
        lat: (bounds.minLat + bounds.maxLat) / 2,
        lon: (bounds.minLon + bounds.maxLon) / 2
    };
}

/**
 * Calculate appropriate OSM zoom level based on bounding box extent
 * @param {Object} bounds - Bounding box {minLat, maxLat, minLon, maxLon, width, height}
 * @returns {number} Zoom level (1-19)
 */
function calculateZoomLevel(bounds) {
    // Calculate the maximum extent in degrees
    const maxExtent = Math.max(bounds.width, bounds.height);

    // Rough zoom level calculation
    // These are approximate zoom levels for different extents
    if (maxExtent > 10) return 6;       // Continental scale
    if (maxExtent > 5) return 7;        // Large region
    if (maxExtent > 2) return 8;        // Region
    if (maxExtent > 1) return 9;        // Large metro area
    if (maxExtent > 0.5) return 10;     // Metro area
    if (maxExtent > 0.25) return 11;    // City
    if (maxExtent > 0.1) return 12;     // Large neighborhood
    if (maxExtent > 0.05) return 13;    // Neighborhood
    if (maxExtent > 0.02) return 14;    // District
    if (maxExtent > 0.01) return 15;    // Small area
    if (maxExtent > 0.005) return 16;   // Very small area
    if (maxExtent > 0.002) return 17;   // Tiny area
    if (maxExtent > 0.001) return 18;   // Building scale
    return 19;                           // Maximum detail (non-editing view)
}

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
    // (with internal _tags sorted to the end)
    if (selectedTags.length < MAX_TAGS_DISPLAY) {
        const remainingKeys = sortTagKeys(
            Object.keys(tags).filter(key => key !== 'name' && !PREFERRED_TAG_KEYS.includes(key))
        );

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
 * @param {Object} options - Options for item creation
 * @param {boolean} options.isImported - Whether this is imported data (hide OSM/JOSM links)
 * @returns {HTMLElement} The geometry item element
 */
function createGeometryItem(geom, index, options = {}) {
    const { isImported = false } = options;
    // Create geometry item container
    const item = document.createElement('div');
    item.className = 'geometry-item';
    item.dataset.osmId = geom.id;
    item.dataset.index = index;

    // Create canvas wrapper for positioning zoom button
    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'canvas-wrapper';

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

    canvasWrapper.appendChild(canvas);

    // Create zoom button
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'zoom-btn';
    zoomBtn.title = 'View larger';
    zoomBtn.dataset.index = index;
    zoomBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 3 21 3 21 9"></polyline>
        <polyline points="9 21 3 21 3 15"></polyline>
        <line x1="21" y1="3" x2="14" y2="10"></line>
        <line x1="3" y1="21" x2="10" y2="14"></line>
    </svg>`;
    // Handle zoom button click - dispatch custom event and stop propagation to item
    zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Dispatch custom event for main.js to handle
        const event = new CustomEvent('geometry-zoom', {
            bubbles: true,
            detail: { index: index }
        });
        zoomBtn.dispatchEvent(event);
    });
    canvasWrapper.appendChild(zoomBtn);

    item.appendChild(canvasWrapper);

    // Create metadata section
    const meta = document.createElement('div');
    meta.className = 'geometry-meta';

    // Create container for links/labels on same line
    const linksContainer = document.createElement('div');
    linksContainer.className = 'osm-links';

    // Handle component vs individual way/relation
    if (geom.type === 'component') {
        if (isImported) {
            // Imported data - just show text, no link
            const label = document.createElement('span');
            label.className = 'osm-id';
            label.textContent = `${geom.sourceWayIds.length} Connected Ways`;
            linksContainer.appendChild(label);
        } else {
            // OSM data - create map view link centered on component
            const osmId = document.createElement('a');
            osmId.className = 'osm-id';
            const centroid = calculateCentroid(geom.bounds);
            const zoom = calculateZoomLevel(geom.bounds);

            osmId.textContent = `${geom.sourceWayIds.length} Connected Ways`;
            osmId.href = `https://www.openstreetmap.org/#map=${zoom}/${centroid.lat.toFixed(6)}/${centroid.lon.toFixed(6)}`;
            osmId.target = '_blank';
            osmId.rel = 'noopener noreferrer';
            osmId.title = `View on OSM map (component of ways: ${geom.sourceWayIds.join(', ')})`;
            linksContainer.appendChild(osmId);
        }
    } else {
        // Individual way or relation
        const osmType = geom.type; // 'way' or 'relation'
        const displayType = osmType.charAt(0).toUpperCase() + osmType.slice(1);

        if (isImported) {
            // Imported data - just show text, no link
            const label = document.createElement('span');
            label.className = 'osm-id';
            label.textContent = `${displayType} ${geom.id}`;
            linksContainer.appendChild(label);
        } else {
            // OSM data - create link
            const osmId = document.createElement('a');
            osmId.className = 'osm-id';
            osmId.href = `https://www.openstreetmap.org/${osmType}/${geom.id}`;
            osmId.target = '_blank';
            osmId.rel = 'noopener noreferrer';
            osmId.textContent = `OSM ${displayType} ${geom.id}`;
            linksContainer.appendChild(osmId);
        }
    }

    // Only show JOSM link for non-imported data (real OSM IDs)
    if (!isImported) {
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
    }

    meta.appendChild(linksContainer);

    // Select and display tags (preview)
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

    // Create expandable section for all tags
    const allTagsCount = Object.keys(geom.tags).length;
    let expandToggle = null;
    if (allTagsCount > selectedTags.length) {
        expandToggle = document.createElement('div');
        expandToggle.className = 'expand-toggle';
        expandToggle.textContent = `Click to view full OSM tags (${allTagsCount} total)`;
        meta.appendChild(expandToggle);
    }

    // Create hidden expanded section with all tags
    const expandedSection = document.createElement('div');
    expandedSection.className = 'tags-expanded hidden';

    // Sort all tags alphabetically (with internal _tags at the end)
    const allTags = sortTagKeys(Object.keys(geom.tags));
    allTags.forEach(key => {
        const tagDiv = document.createElement('div');
        tagDiv.className = 'osm-tag-full';
        tagDiv.innerHTML = `<strong>${key}:</strong> ${geom.tags[key]}`;
        expandedSection.appendChild(tagDiv);
    });

    meta.appendChild(expandedSection);

    item.appendChild(meta);

    // Add click handler - on mobile open gallery, on desktop toggle expansion
    item.addEventListener('click', (e) => {
        // Don't handle if clicking on a link
        if (e.target.tagName === 'A') {
            return;
        }

        // Check if mobile/touch device (matches 768px breakpoint)
        const isMobile = window.matchMedia('(max-width: 768px)').matches;

        if (isMobile) {
            // On mobile, open the detail gallery view
            const event = new CustomEvent('geometry-zoom', {
                bubbles: true,
                detail: { index: index }
            });
            item.dispatchEvent(event);
        } else {
            // On desktop, toggle expansion
            item.classList.toggle('expanded');
            expandedSection.classList.toggle('hidden');

            // Update toggle text if it exists
            if (expandToggle) {
                if (item.classList.contains('expanded')) {
                    expandToggle.textContent = 'Click to collapse';
                } else {
                    expandToggle.textContent = `Click to view full OSM tags (${allTagsCount} total)`;
                }
            }
        }
    });

    return item;
}

/**
 * Render a batch of geometries into the grid
 * @param {HTMLElement} container - The container element for the grid
 * @param {Array} geometries - Array of GeometryObject
 * @param {number} startIndex - Start index in the geometries array
 * @param {number} endIndex - End index in the geometries array
 * @param {Object} options - Options for item creation
 */
function renderBatch(container, geometries, startIndex, endIndex, options = {}) {
    const fragment = document.createDocumentFragment();
    const slice = geometries.slice(startIndex, endIndex);

    slice.forEach((geom, relativeIndex) => {
        const absoluteIndex = startIndex + relativeIndex;
        const item = createGeometryItem(geom, absoluteIndex, options);
        fragment.appendChild(item);
    });

    container.appendChild(fragment);
}

/**
 * Create a grid of canvas elements for geometries
 * @param {HTMLElement} container - The container element for the grid
 * @param {Array} geometries - Array of GeometryObject
 * @param {Object} options - Options for grid creation
 * @param {number} options.initialBatch - Initial batch size for lazy loading
 * @param {number} options.lazyLoadThreshold - Threshold to enable lazy loading
 * @param {boolean} options.isImported - Whether this is imported data (hide OSM/JOSM links)
 * @returns {Object} Grid creation result
 */
export function createGrid(container, geometries, options = {}) {
    const { initialBatch = 50, lazyLoadThreshold = 100, isImported = false } = options;

    // Options to pass through to item creation
    const itemOptions = { isImported };

    // Clear existing content
    container.innerHTML = '';

    if (!geometries || geometries.length === 0) {
        return { isLazyLoaded: false, renderedCount: 0, totalCount: 0, isImported };
    }

    // Determine if lazy loading should be enabled
    const lazyLoadEnabled = geometries.length >= lazyLoadThreshold;

    if (!lazyLoadEnabled) {
        // Render all geometries for small datasets
        renderBatch(container, geometries, 0, geometries.length, itemOptions);
        return {
            isLazyLoaded: false,
            renderedCount: geometries.length,
            totalCount: geometries.length,
            isImported
        };
    }

    // Lazy loading: render initial batch
    const initialCount = Math.min(initialBatch, geometries.length);
    renderBatch(container, geometries, 0, initialCount, itemOptions);

    return {
        isLazyLoaded: true,
        renderedCount: initialCount,
        totalCount: geometries.length,
        isImported
    };
}

/**
 * Append more items to the grid (for lazy loading)
 * @param {HTMLElement} container - The grid container
 * @param {Array} geometries - Full array of GeometryObject
 * @param {number} startIndex - Start index for new batch
 * @param {number} endIndex - End index for new batch
 * @param {Object} options - Options for item creation
 */
export function appendBatch(container, geometries, startIndex, endIndex, options = {}) {
    renderBatch(container, geometries, startIndex, endIndex, options);
}

/**
 * Get all canvas elements from the grid
 * @param {HTMLElement} container - The grid container
 * @returns {Array<HTMLCanvasElement>} Array of canvas elements
 */
export function getCanvases(container) {
    return Array.from(container.querySelectorAll('canvas'));
}
