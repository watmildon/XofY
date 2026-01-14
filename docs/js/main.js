/**
 * main.js
 * Main application entry point
 * Coordinates the flow between all modules
 */

import { executeQuery, DEFAULT_OVERPASS_URL } from './overpassClient.js';
import { parseElements } from './geometryParser.js';
import { getGlobalBounds } from './boundingBox.js';
import { createGrid, getCanvases, appendBatch } from './gridLayout.js';
import { renderGeometry } from './canvasRenderer.js';
import { reprojectBounds } from './reproject.js';

// DOM elements
const queryTextarea = document.getElementById('overpass-query');
const submitBtn = document.getElementById('submit-btn');
const exampleSelect = document.getElementById('example-select');
const sortSelect = document.getElementById('sort-select');
const scaleToggle = document.getElementById('scale-toggle');
const fillColorInput = document.getElementById('fill-color');
const respectOsmColorsToggle = document.getElementById('respect-osm-colors');
const overpassServerSelect = document.getElementById('overpass-server-select');
const overpassCustomUrlInput = document.getElementById('overpass-custom-url');
const customUrlGroup = document.getElementById('custom-url-group');
const themeSelect = document.getElementById('theme-select');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const warningsDiv = document.getElementById('warnings');
const statsDiv = document.getElementById('stats');
const gridContainer = document.getElementById('geometry-grid');
const lazyLoadingDiv = document.getElementById('lazy-loading');
const backToTopBtn = document.getElementById('back-to-top');
const groupByToggle = document.getElementById('group-by-toggle');
const groupByTagInput = document.getElementById('group-by-tag');
const shareBtn = document.getElementById('share-btn');
const importSection = document.getElementById('import-section');
const geojsonImport = document.getElementById('geojson-import');

// Example queries
const EXAMPLE_QUERIES = {
    'churches_seattle': {
        query: `[out:json];
rel["type"="boundary"]["name"="Seattle"]["admin_level"="8"];
map_to_area->.searchArea;
wr(area.searchArea)["building"="church"];
out geom;`
    },
    'parks_seattle': {
        query: `[out:json];
rel["type"="boundary"]["name"="Seattle"]["admin_level"="8"];
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="park"][name];
out geom;`
    },
    'museums_paris': {
        query: `[out:json];
rel["type"="boundary"]["name"="Paris"]["admin_level"="8"];
map_to_area->.searchArea;
wr(area.searchArea)["tourism"="museum"];
out geom;`
    },
    'pools_phoenix': {
        query: `[out:json];
rel["type"="boundary"]["name"="Phoenix"]["admin_level"="8"];
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out geom;`
    },
    'highways_seattle': {
        query: `[out:json];
rel["type"="boundary"]["name"="Seattle"]["admin_level"="8"];
map_to_area->.searchArea;
way(area.searchArea)["highway"="primary"][name];
out geom;`,
        groupBy: true,
        groupByTag: 'name'
    },
    'waterslides_arizona': {
        query: `[out:json];
rel["type"="boundary"]["name"="Arizona"]["admin_level"="4"];
map_to_area->.searchArea;
way(area.searchArea)["attraction"="water_slide"];
out geom;`
    },
    'raceways_germany': {
        query: `[out:json];
rel["type"="boundary"]["name"="Deutschland"]["admin_level"="2"];
map_to_area->.searchArea;
way(area.searchArea)["highway"="raceway"]["sport"="motor"];
out geom;`
    },
    'cooling_basins': {
        query: `[out:json];
wr["basin"="cooling"];
out geom;`
    },
    'lakes_jetsprint': {
        query: `[out:json];
wr["sport"="jetsprint"]["natural"="water"];
out geom;`
    },
    'shotput_poland': {
        query: `[out:json];
rel["type"="boundary"]["name"="Polska"]["admin_level"="2"];
map_to_area->.searchArea;
wr(area.searchArea)[athletics=shot_put];
out geom;`
    },
    'mazes_ohio': {
        query: `[out:json];
rel["type"="boundary"]["name"="Butler County"]["admin_level"="6"];
map_to_area->.searchArea;

way(area.searchArea)["attraction"="maze"]->.mazes;

//.mazes;
//out geom;

foreach.mazes(
    (._;);
    map_to_area->.maze;
    way(area.maze)["highway"~"^(footway|path)$"];
    out geom;
);`
    },
    'tracks_sydney': {
        query: `[out:json];
rel(5750005);map_to_area->.searchArea;
map_to_area->.searchArea;
wr(area.searchArea)[leisure=track][!athletics];
out geom;`
    },
    'subway_nyc': {
        query: `[out:json];
rel[route=subway][network="NYC Subway"];
out geom;`
    },
    'aircraft_uk': {
        query: `[out:json];
rel["type"="boundary"]["name"="United Kingdom"]["admin_level"="2"];
map_to_area->.searchArea;
wr(area.searchArea)["historic"="aircraft"];
out geom;`
    },
    'rollercoasters_disneyworld': {
        query: `[out:json];
rel(1228099);map_to_area->.searchArea;
wr(area.searchArea)["roller_coaster"="track"];
out geom;`
    },
    'cathedrals_italy': {
        query: `[out:json];
rel["type"="boundary"]["name"="Italia"]["admin_level"="2"];
map_to_area->.searchArea;
wr(area.searchArea)["building"="cathedral"];
out geom;`
    },
    'lazy_rivers_california': {
        query: `[out:json];
rel["type"="boundary"]["name"="California"]["admin_level"="4"];
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"]["swimming_pool"="lazy_river"];
out geom;`
    },
    'flowerbeds_uk': {
        query: `[out:json];
rel["type"="boundary"]["name"="United Kingdom"]["admin_level"="2"];
map_to_area->.searchArea;
way(area.searchArea)["landuse"="flowerbed"];
foreach (
  way._(if:count_members() > 50);
  out geom;
);`
    },
    'playground_maps_usa': {
        query: `[out:json];
rel["type"="boundary"]["name"="United States"]["admin_level"="2"];
map_to_area->.searchArea;
wr(area.searchArea)["playground"="map"];
out geom;`
    }
};

// Application state
let currentGeometries = [];
let currentGlobalBounds = null;
let currentMaxDimension = null;
let currentFillColor = '#3388ff';
let currentOverpassUrl = DEFAULT_OVERPASS_URL;
let respectOsmColors = true; // Default to respecting OSM colours

// Lazy loading state
let lazyLoadState = {
    enabled: false,
    renderedCount: 0,
    totalCount: 0,
    isLoading: false,
    batchSize: 50,
    loadThreshold: 300, // pixels from bottom
    isImported: false   // whether current data is from GeoJSON import
};

// LocalStorage keys
const STORAGE_KEYS = {
    QUERY: 'xofy-osm-query',
    FILL_COLOR: 'xofy-osm-fill-color',
    SCALE_TOGGLE: 'xofy-osm-scale-toggle',
    OVERPASS_URL: 'xofy-osm-overpass-url',
    THEME: 'xofy-osm-theme',
    GROUP_BY_ENABLED: 'xofy-osm-group-by-enabled',
    GROUP_BY_TAG: 'xofy-osm-group-by-tag',
    RESPECT_OSM_COLORS: 'xofy-osm-respect-osm-colors',
    SORT_BY: 'xofy-osm-sort-by'
};

/**
 * Apply theme to document
 * @param {string} theme - 'auto', 'light', or 'dark'
 */
function applyTheme(theme) {
    const root = document.documentElement;

    if (theme === 'auto') {
        // Remove data-theme attribute to let CSS media query handle it
        root.removeAttribute('data-theme');
    } else {
        // Set data-theme attribute to override system preference
        root.setAttribute('data-theme', theme);
    }
}

/**
 * Get the current Overpass URL from the UI
 * @returns {string} The current Overpass URL
 */
function getCurrentOverpassUrl() {
    const selectedValue = overpassServerSelect.value;
    if (selectedValue === 'custom') {
        return overpassCustomUrlInput.value.trim() || DEFAULT_OVERPASS_URL;
    }
    return selectedValue;
}

/**
 * Save settings to localStorage
 */
function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEYS.QUERY, queryTextarea.value);
        localStorage.setItem(STORAGE_KEYS.FILL_COLOR, currentFillColor);
        localStorage.setItem(STORAGE_KEYS.SCALE_TOGGLE, scaleToggle.checked.toString());
        localStorage.setItem(STORAGE_KEYS.OVERPASS_URL, getCurrentOverpassUrl());
        localStorage.setItem(STORAGE_KEYS.THEME, themeSelect.value);
        localStorage.setItem(STORAGE_KEYS.GROUP_BY_ENABLED, groupByToggle.checked.toString());
        localStorage.setItem(STORAGE_KEYS.GROUP_BY_TAG, groupByTagInput.value.trim() || 'name');
        localStorage.setItem(STORAGE_KEYS.RESPECT_OSM_COLORS, respectOsmColors.toString());
        localStorage.setItem(STORAGE_KEYS.SORT_BY, sortSelect.value);
    } catch (e) {
        console.warn('Failed to save settings to localStorage:', e);
    }
}

/**
 * Load settings from localStorage
 * @returns {Object} Saved settings or defaults
 */
function loadSettings() {
    const defaults = {
        query: `// Named parks of Seattle, WA
[out:json];
rel["type"="boundary"]["name"="Seattle"];
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="park"][name];
out geom;`,
        fillColor: '#3388ff',
        scaleToggle: false,
        overpassUrl: 'https://overpass.private.coffee/api/interpreter',
        theme: 'auto',
        groupByEnabled: false,
        groupByTag: 'name',
        respectOsmColors: true,
        sortBy: 'nodes-desc'
    };

    try {
        const savedQuery = localStorage.getItem(STORAGE_KEYS.QUERY);
        const savedFillColor = localStorage.getItem(STORAGE_KEYS.FILL_COLOR);
        const savedScaleToggle = localStorage.getItem(STORAGE_KEYS.SCALE_TOGGLE);
        const savedOverpassUrl = localStorage.getItem(STORAGE_KEYS.OVERPASS_URL);
        const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
        const savedGroupByEnabled = localStorage.getItem(STORAGE_KEYS.GROUP_BY_ENABLED);
        const savedGroupByTag = localStorage.getItem(STORAGE_KEYS.GROUP_BY_TAG);
        const savedRespectOsmColors = localStorage.getItem(STORAGE_KEYS.RESPECT_OSM_COLORS);
        const savedSortBy = localStorage.getItem(STORAGE_KEYS.SORT_BY);

        return {
            query: savedQuery || defaults.query,
            fillColor: savedFillColor || defaults.fillColor,
            scaleToggle: savedScaleToggle === 'true',
            overpassUrl: savedOverpassUrl || defaults.overpassUrl,
            theme: savedTheme || defaults.theme,
            groupByEnabled: savedGroupByEnabled === 'true',
            groupByTag: savedGroupByTag || defaults.groupByTag,
            respectOsmColors: savedRespectOsmColors === null ? defaults.respectOsmColors : savedRespectOsmColors === 'true',
            sortBy: savedSortBy || defaults.sortBy
        };
    } catch (e) {
        console.warn('Failed to load settings from localStorage:', e);
        return defaults;
    }
}

/**
 * Convert GeoJSON to Overpass API element format
 * This allows imported GeoJSON to benefit from the same merging logic as Overpass queries
 * @param {Object} geojson - GeoJSON FeatureCollection or single Feature
 * @returns {Array} Array of Overpass-like element objects
 */
function convertGeoJsonToElements(geojson) {
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

/**
 * Show loading state
 */
function showLoading() {
    loadingDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    warningsDiv.classList.add('hidden');
    statsDiv.classList.add('hidden');
    submitBtn.disabled = true;
}

/**
 * Hide loading state
 */
function hideLoading() {
    loadingDiv.classList.add('hidden');
    submitBtn.disabled = false;
}

/**
 * Show error message
 * @param {string} message - Error message to display
 */
function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

/**
 * Show warnings
 * @param {Array<Object>} warnings - Array of warning objects with message/reason, osmType, and osmId
 */
function showWarnings(warnings) {
    if (warnings.length === 0) {
        warningsDiv.classList.add('hidden');
        return;
    }

    // Helper function to format a warning with clickable OSM link
    function formatWarning(warning) {
        // Get the warning text - support both 'message' and 'reason' fields
        const warningText = warning.message || warning.reason;

        if (!warningText) {
            console.error('[main.js] Warning missing both message and reason:', warning);
            return 'Unknown warning (missing message/reason)';
        }

        if (!warning.osmType || !warning.osmId) {
            // Fallback for warnings without OSM link info
            return typeof warning === 'string' ? warning : warningText;
        }

        const osmUrl = `https://www.openstreetmap.org/${warning.osmType}/${warning.osmId}`;

        // Replace the OSM ID in the message with a clickable link
        const idPattern = new RegExp(`(${warning.osmType}\\s+)(${warning.osmId})`, 'i');
        const linkedMessage = warningText.replace(
            idPattern,
            `$1<a href="${osmUrl}" target="_blank" rel="noopener noreferrer">${warning.osmId}</a>`
        );

        return linkedMessage;
    }

    const html = `
        <h3>Skipped ${warnings.length} item(s):</h3>
        <ul>
            ${warnings.slice(0, 10).map(w => `<li>${formatWarning(w)}</li>`).join('')}
            ${warnings.length > 10 ? `<li>... and ${warnings.length - 10} more</li>` : ''}
        </ul>
    `;

    warningsDiv.innerHTML = html;
    warningsDiv.classList.remove('hidden');
}

/**
 * Show complexity error (network too complex)
 * @param {Error} error - The complexity error object
 */
function showComplexityError(error) {
    const details = error.details || {};
    const topNodes = details.topComplexNodes || [];

    let html = `
        <strong>Network Too Complex</strong>
        <p>${error.message}</p>
    `;

    if (topNodes.length > 0) {
        html += `
            <details>
                <summary>See top ${topNodes.length} complex nodes</summary>
                <ul>
                    ${topNodes.map(node => {
                        const wayLinks = node.wayIds.slice(0, 5).map(wayId =>
                            `<a href="https://www.openstreetmap.org/way/${wayId}" target="_blank" rel="noopener noreferrer">${wayId}</a>`
                        ).join(', ');
                        const moreWays = node.wayIds.length > 5 ? '...' : '';
                        return `
                        <li>Node at (${node.coords[0].toFixed(6)}, ${node.coords[1].toFixed(6)}):
                        ${node.connectionCount} connections from ways
                        ${wayLinks}${moreWays}</li>
                        `;
                    }).join('')}
                </ul>
            </details>
        `;
    }

    if (details.suggestion) {
        html += `<p class="suggestion">💡 ${details.suggestion}</p>`;
    }

    errorDiv.innerHTML = html;
    errorDiv.classList.remove('hidden');
}

/**
 * Show statistics
 * @param {number} totalCount - Total elements received
 * @param {Array} geometries - Array of geometry objects
 * @param {number} skippedCount - Number of geometries skipped
 */
function showStats(totalCount, geometries, skippedCount) {
    // Count geometry types
    const polygons = geometries.filter(g =>
        g.geometry.type === 'Polygon' || g.geometry.type === 'MultiPolygon'
    ).length;
    const linestrings = geometries.filter(g =>
        g.geometry.type === 'LineString' || g.geometry.type === 'MultiLineString'
    ).length;
    const components = geometries.filter(g => g.type === 'component').length;

    // Build summary text
    const parts = [];
    if (polygons > 0) parts.push(`${polygons} polygon(s)`);
    if (linestrings > 0) parts.push(`${linestrings} linestring(s)`);
    if (components > 0) parts.push(`${components} connected group(s)`);

    const summary = parts.length > 0 ? parts.join(', ') : `${geometries.length} feature(s)`;
    statsDiv.textContent = `Showing ${summary} from ${totalCount} total element(s)${skippedCount > 0 ? `, skipped ${skippedCount}` : ''}`;
    statsDiv.classList.remove('hidden');
}

/**
 * Render all geometries on their canvases (only renders loaded items)
 */
function renderAllGeometries() {
    if (currentGeometries.length === 0) {
        return;
    }

    const canvases = getCanvases(gridContainer);
    const maintainRelativeSize = scaleToggle.checked;

    const renderOptions = {
        maintainRelativeSize,
        maxDimension: maintainRelativeSize ? currentMaxDimension : null,
        fillColor: currentFillColor,
        respectOsmColors
    };

    // Only render canvases that are currently in the DOM
    canvases.forEach(canvas => {
        const index = parseInt(canvas.dataset.index);
        const geom = currentGeometries[index];
        if (geom) {
            renderGeometry(canvas, geom, renderOptions);
        }
    });
}

/**
 * Render geometries for a specific batch
 */
function renderGeometriesForBatch(startIndex, endIndex) {
    const renderOptions = {
        maintainRelativeSize: scaleToggle.checked,
        maxDimension: currentMaxDimension,
        fillColor: currentFillColor,
        respectOsmColors
    };

    const canvases = getCanvases(gridContainer);
    canvases.forEach(canvas => {
        const index = parseInt(canvas.dataset.index);
        if (index >= startIndex && index < endIndex) {
            const geom = currentGeometries[index];
            if (geom) {
                renderGeometry(canvas, geom, renderOptions);
            }
        }
    });
}

/**
 * Load more items for lazy loading
 */
function loadMoreItems() {
    if (!lazyLoadState.enabled || lazyLoadState.isLoading) {
        return;
    }

    if (lazyLoadState.renderedCount >= lazyLoadState.totalCount) {
        return; // All items loaded
    }

    lazyLoadState.isLoading = true;
    lazyLoadingDiv.classList.remove('hidden');

    // Calculate batch range
    const startIndex = lazyLoadState.renderedCount;
    const endIndex = Math.min(
        startIndex + lazyLoadState.batchSize,
        lazyLoadState.totalCount
    );

    // Use setTimeout to allow UI to update before heavy rendering
    setTimeout(() => {
        // Append new items to DOM
        appendBatch(gridContainer, currentGeometries, startIndex, endIndex, {
            isImported: lazyLoadState.isImported
        });

        // Render the new batch
        renderGeometriesForBatch(startIndex, endIndex);

        // Update state
        lazyLoadState.renderedCount = endIndex;
        lazyLoadState.isLoading = false;
        lazyLoadingDiv.classList.add('hidden');

        console.log(`Loaded batch: ${startIndex}-${endIndex} of ${lazyLoadState.totalCount}`);
    }, 50);
}

/**
 * Handle scroll for lazy loading and back-to-top button
 */
function handleScroll() {
    // Always check back-to-top button visibility (independent of lazy loading)
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    if (scrollTop > 600) { // Approximately 2 rows of items
        backToTopBtn.classList.remove('hidden');
    } else {
        backToTopBtn.classList.add('hidden');
    }

    // Only do lazy loading checks if enabled
    if (!lazyLoadState.enabled) {
        return;
    }

    // Check if we should load more items
    if (lazyLoadState.isLoading || lazyLoadState.renderedCount >= lazyLoadState.totalCount) {
        return;
    }

    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const distanceFromBottom = documentHeight - (scrollTop + windowHeight);

    if (distanceFromBottom < lazyLoadState.loadThreshold) {
        loadMoreItems();
    }
}

/**
 * Setup lazy loading scroll listener
 */
function setupLazyLoading() {
    // Throttle scroll events
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(handleScroll, 100);
    });
}

/**
 * Cleanup lazy loading (remove scroll listener, hide elements)
 */
function cleanupLazyLoading() {
    lazyLoadState.enabled = false;
    lazyLoadState.renderedCount = 0;
    lazyLoadState.totalCount = 0;
    lazyLoadingDiv.classList.add('hidden');
    backToTopBtn.classList.add('hidden');
}

/**
 * Handle back to top button click
 */
function handleBackToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Sort geometries based on the selected sort order
 * @param {Array} geometries - Array of geometry objects
 * @param {string} sortBy - Sort option ('default', 'nodes-asc', 'nodes-desc', 'size-asc', 'size-desc')
 * @returns {Array} Sorted array of geometries
 */
function sortGeometries(geometries, sortBy) {
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

/**
 * Apply current sorting and rebuild the grid
 */
function applySorting() {
    if (currentGeometries.length === 0) {
        return;
    }

    // Cleanup lazy loading state
    cleanupLazyLoading();

    // Sort the geometries in place
    currentGeometries = sortGeometries(currentGeometries, sortSelect.value);

    // Rebuild grid with lazy loading support (preserve isImported state)
    const gridResult = createGrid(gridContainer, currentGeometries, {
        initialBatch: 50,
        lazyLoadThreshold: 100,
        isImported: lazyLoadState.isImported || false
    });

    // Update lazy loading state
    lazyLoadState.enabled = gridResult.isLazyLoaded;
    lazyLoadState.renderedCount = gridResult.renderedCount;
    lazyLoadState.totalCount = gridResult.totalCount;
    lazyLoadState.isImported = gridResult.isImported;

    // Render geometries
    renderAllGeometries();

    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Handle sort selection change
 */
function handleSortChange() {
    applySorting();
    saveSettings();
}

/**
 * Handle query submission
 */
async function handleSubmit() {
    const query = queryTextarea.value.trim();

    if (!query) {
        showError('Please enter an Overpass query');
        return;
    }

    showLoading();

    // Cleanup any previous lazy loading state
    cleanupLazyLoading();

    try {
        // Execute query
        console.log('Executing query...');
        const data = await executeQuery(query, currentOverpassUrl);
        console.log('Received data:', data);

        // Parse elements with grouping options
        const parseOptions = {
            groupByEnabled: groupByToggle.checked,
            groupByTag: groupByTagInput.value.trim() || 'name'
        };
        const { geometries, warnings } = parseElements(data.elements || [], parseOptions);
        console.log('Parsed geometries:', geometries);
        console.log('Warnings:', warnings);

        // Show warnings
        showWarnings(warnings);

        // Check if we have any geometries
        if (geometries.length === 0) {
            hideLoading();
            if (warnings.length > 0) {
                showError('No valid geometries found. All results were filtered out (see warnings above).');
            } else {
                showError('No results found. Try adjusting your query or bounding box.');
            }
            gridContainer.innerHTML = '';
            return;
        }

        // Calculate global bounds and max dimension
        currentGlobalBounds = getGlobalBounds(geometries);

        // Apply sorting before storing
        currentGeometries = sortGeometries(geometries, sortSelect.value);

        // Find the largest dimension (for relative size scaling)
        // Use reprojected bounds to match the renderer's coordinate space
        currentMaxDimension = Math.max(
            ...currentGeometries.map(geom => {
                const projBounds = reprojectBounds(geom.bounds);
                return Math.max(projBounds.width, projBounds.height);
            })
        );

        // Show statistics
        showStats(
            data.elements ? data.elements.length : 0,
            currentGeometries,
            warnings.length
        );

        // Create grid with lazy loading support
        const gridResult = createGrid(gridContainer, currentGeometries, {
            initialBatch: 50,
            lazyLoadThreshold: 100,
            isImported: false
        });

        // Update lazy loading state
        lazyLoadState.enabled = gridResult.isLazyLoaded;
        lazyLoadState.renderedCount = gridResult.renderedCount;
        lazyLoadState.totalCount = gridResult.totalCount;
        lazyLoadState.isImported = gridResult.isImported;

        // Render geometries (only those currently in DOM)
        renderAllGeometries();

        hideLoading();

        // Save settings after successful query
        saveSettings();

    } catch (error) {
        console.error('Error:', error);
        hideLoading();

        // Handle complexity errors specially
        if (error.type === 'NETWORK_TOO_COMPLEX') {
            showComplexityError(error);
        } else {
            showError(error.message || 'An error occurred while processing the query');
        }
    }
}

/**
 * Handle scale toggle change
 */
function handleScaleToggle() {
    if (currentGeometries.length > 0) {
        renderAllGeometries();
    }
    saveSettings();
}

/**
 * Handle fill color change
 */
function handleFillColorChange() {
    currentFillColor = fillColorInput.value;
    if (currentGeometries.length > 0) {
        renderAllGeometries();
    }
    saveSettings();
}

/**
 * Handle respect OSM colors toggle change
 */
function handleRespectOsmColorsToggle() {
    respectOsmColors = respectOsmColorsToggle.checked;
    if (currentGeometries.length > 0) {
        renderAllGeometries();
    }
    saveSettings();
}

/**
 * Handle Overpass server selection change
 */
function handleOverpassServerChange() {
    const selectedValue = overpassServerSelect.value;

    // Show/hide custom URL input
    if (selectedValue === 'custom') {
        customUrlGroup.classList.remove('hidden');
    } else {
        customUrlGroup.classList.add('hidden');
    }

    // Update current URL
    currentOverpassUrl = getCurrentOverpassUrl();
    saveSettings();
}

/**
 * Handle custom Overpass URL change
 */
function handleOverpassCustomUrlChange() {
    currentOverpassUrl = getCurrentOverpassUrl();
    saveSettings();
}

/**
 * Handle theme change
 */
function handleThemeChange() {
    const theme = themeSelect.value;
    applyTheme(theme);
    saveSettings();
}

/**
 * Handle group by toggle change
 */
function handleGroupByToggle() {
    if (groupByToggle.checked) {
        groupByTagInput.classList.remove('hidden');
    } else {
        groupByTagInput.classList.add('hidden');
    }
    saveSettings();
}

/**
 * Handle group by tag input change
 */
function handleGroupByTagChange() {
    saveSettings();
}

/**
 * Encode current state to URL parameters
 * @returns {string} URL with encoded parameters
 */
function encodeStateToURL() {
    const params = new URLSearchParams();

    // Only add parameters that differ from defaults
    if (queryTextarea.value.trim()) {
        params.set('q', btoa(encodeURIComponent(queryTextarea.value)));
    }

    if (fillColorInput.value !== '#3388ff') {
        params.set('color', fillColorInput.value.substring(1)); // Remove #
    }

    if (scaleToggle.checked) {
        params.set('scale', '1');
    }

    if (groupByToggle.checked) {
        params.set('group', '1');
        if (groupByTagInput.value && groupByTagInput.value !== 'name') {
            params.set('gtag', groupByTagInput.value);
        }
    }

    const url = new URL(window.location.href);
    url.search = params.toString();
    return url.toString();
}

/**
 * Decode URL parameters and apply to state
 * @returns {Object|null} Decoded state or null if no parameters
 */
function decodeURLParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.toString() === '') {
        return null;
    }

    const state = {};

    // Decode query
    if (params.has('q')) {
        try {
            state.query = decodeURIComponent(atob(params.get('q')));
        } catch (e) {
            console.warn('Failed to decode query parameter:', e);
        }
    }

    // Decode color
    if (params.has('color')) {
        state.fillColor = '#' + params.get('color');
    }

    // Decode scale toggle
    if (params.has('scale')) {
        state.scaleToggle = params.get('scale') === '1';
    }

    // Decode group by
    if (params.has('group')) {
        state.groupByEnabled = params.get('group') === '1';
        if (params.has('gtag')) {
            state.groupByTag = params.get('gtag');
        }
    }

    return state;
}

/**
 * Handle share button click
 */
async function handleShare() {
    const shareURL = encodeStateToURL();

    try {
        // Try to use native share API if available
        if (navigator.share) {
            await navigator.share({
                title: 'XofY OSM Geometry Viewer',
                text: 'Check out this OpenStreetMap query',
                url: shareURL
            });
        } else {
            // Fallback: copy to clipboard
            await navigator.clipboard.writeText(shareURL);

            // Show temporary success message
            const originalTitle = shareBtn.title;
            shareBtn.title = 'Link copied to clipboard!';
            shareBtn.style.color = 'var(--accent-primary)';

            setTimeout(() => {
                shareBtn.title = originalTitle;
                shareBtn.style.color = '';
            }, 2000);
        }
    } catch (err) {
        console.error('Share failed:', err);
        // Show error message
        showError('Failed to share. Please copy the URL from your address bar.');
    }
}

/**
 * Handle GeoJSON file import
 */
async function handleGeojsonImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset the file input so the same file can be imported again
    event.target.value = '';

    try {
        showLoading();

        const text = await file.text();
        const geojson = JSON.parse(text);

        // Convert GeoJSON to Overpass element format, then parse with merging logic
        const elements = convertGeoJsonToElements(geojson);

        if (elements.length === 0) {
            hideLoading();
            showError('No valid geometries found in GeoJSON file');
            return;
        }

        // Parse elements with grouping options (same as Overpass queries)
        const parseOptions = {
            groupByEnabled: groupByToggle.checked,
            groupByTag: groupByTagInput.value.trim() || 'name'
        };
        const { geometries, warnings } = parseElements(elements, parseOptions);

        if (geometries.length === 0) {
            hideLoading();
            showError('No valid geometries found after parsing');
            if (warnings.length > 0) {
                showWarnings(warnings);
            }
            return;
        }

        // Show warnings
        showWarnings(warnings);

        // Process geometries same as Overpass results
        // Apply sorting before storing
        currentGeometries = sortGeometries(geometries, sortSelect.value);

        // Calculate global bounds and max dimension
        currentGlobalBounds = getGlobalBounds(currentGeometries);

        // Find the largest dimension (for relative size scaling)
        // Use reprojected bounds to match the renderer's coordinate space
        currentMaxDimension = Math.max(
            ...currentGeometries.map(geom => {
                const projBounds = reprojectBounds(geom.bounds);
                return Math.max(projBounds.width, projBounds.height);
            })
        );

        // Show statistics
        showStats(
            currentGeometries.length,
            currentGeometries,
            warnings.length
        );

        // Create grid with lazy loading support (hide OSM/JOSM links for imported data)
        const gridResult = createGrid(gridContainer, currentGeometries, {
            initialBatch: 50,
            lazyLoadThreshold: 100,
            isImported: true
        });

        // Update lazy loading state
        lazyLoadState.enabled = gridResult.isLazyLoaded;
        lazyLoadState.renderedCount = gridResult.renderedCount;
        lazyLoadState.totalCount = gridResult.totalCount;
        lazyLoadState.isImported = gridResult.isImported;

        // Render geometries (only those currently in DOM)
        renderAllGeometries();

        hideLoading();

    } catch (error) {
        hideLoading();
        console.error('GeoJSON import error:', error);
        showError(`Failed to load GeoJSON: ${error.message}`);
    }
}

/**
 * Handle example query selection
 */
function handleExampleSelect() {
    const selectedExample = exampleSelect.value;
    if (selectedExample && EXAMPLE_QUERIES[selectedExample]) {
        const example = EXAMPLE_QUERIES[selectedExample];

        // Support both old string format and new object format
        if (typeof example === 'string') {
            queryTextarea.value = example;
            // Default to unchecked for legacy string format
            groupByToggle.checked = false;
            groupByTagInput.classList.add('hidden');
        } else {
            queryTextarea.value = example.query;

            // Apply group by settings - default to false if not specified
            const shouldGroupBy = example.groupBy === true;
            groupByToggle.checked = shouldGroupBy;
            if (shouldGroupBy) {
                groupByTagInput.classList.remove('hidden');
            } else {
                groupByTagInput.classList.add('hidden');
            }

            // Apply group by tag if specified, otherwise keep current value
            if (example.groupByTag !== undefined) {
                groupByTagInput.value = example.groupByTag;
            }
        }

        saveSettings();
        // Reset the select to show "Choose an example..."
        exampleSelect.value = '';
    }
}

/**
 * Open settings modal
 */
function openSettings() {
    settingsModal.classList.remove('hidden');
}

/**
 * Close settings modal
 */
function closeSettings() {
    settingsModal.classList.add('hidden');
}

/**
 * Initialize the application
 */
function init() {
    // Check for URL parameters first (they override saved settings)
    const urlParams = decodeURLParams();

    // Load saved settings
    const settings = loadSettings();

    // Merge URL parameters with saved settings (URL params take precedence)
    const finalSettings = {
        ...settings,
        ...urlParams
    };

    // Apply settings to UI
    queryTextarea.value = finalSettings.query;
    fillColorInput.value = finalSettings.fillColor;
    scaleToggle.checked = finalSettings.scaleToggle;
    respectOsmColorsToggle.checked = finalSettings.respectOsmColors;
    themeSelect.value = settings.theme; // Theme not shared via URL
    groupByToggle.checked = finalSettings.groupByEnabled;
    groupByTagInput.value = finalSettings.groupByTag;
    sortSelect.value = settings.sortBy; // Sort preference persists
    currentFillColor = finalSettings.fillColor;
    respectOsmColors = finalSettings.respectOsmColors;
    currentOverpassUrl = settings.overpassUrl; // Overpass URL not shared

    // Show/hide group by tag input based on toggle
    if (finalSettings.groupByEnabled) {
        groupByTagInput.classList.remove('hidden');
    } else {
        groupByTagInput.classList.add('hidden');
    }

    // Set Overpass server select
    const predefinedServers = [
        'https://overpass.private.coffee/api/interpreter',
        'https://overpass-api.de/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    if (predefinedServers.includes(settings.overpassUrl)) {
        overpassServerSelect.value = settings.overpassUrl;
        customUrlGroup.classList.add('hidden');
    } else {
        overpassServerSelect.value = 'custom';
        overpassCustomUrlInput.value = settings.overpassUrl;
        customUrlGroup.classList.remove('hidden');
    }

    // Apply theme
    applyTheme(settings.theme);

    // Show import section (available everywhere)
    importSection.classList.remove('hidden');
    geojsonImport.addEventListener('change', handleGeojsonImport);

    // Event listeners
    submitBtn.addEventListener('click', handleSubmit);
    exampleSelect.addEventListener('change', handleExampleSelect);
    sortSelect.addEventListener('change', handleSortChange);
    scaleToggle.addEventListener('change', handleScaleToggle);
    fillColorInput.addEventListener('input', handleFillColorChange);
    respectOsmColorsToggle.addEventListener('change', handleRespectOsmColorsToggle);
    overpassServerSelect.addEventListener('change', handleOverpassServerChange);
    overpassCustomUrlInput.addEventListener('blur', handleOverpassCustomUrlChange);
    themeSelect.addEventListener('change', handleThemeChange);
    groupByToggle.addEventListener('change', handleGroupByToggle);
    groupByTagInput.addEventListener('blur', handleGroupByTagChange);
    backToTopBtn.addEventListener('click', handleBackToTop);
    shareBtn.addEventListener('click', handleShare);

    // Ensure modal is hidden on startup
    settingsModal.classList.add('hidden');

    // Settings modal
    settingsBtn.addEventListener('click', openSettings);
    closeSettingsBtn.addEventListener('click', closeSettings);

    // Close modal when clicking on backdrop (not on modal content)
    settingsModal.addEventListener('click', (e) => {
        // Check if the click target is the modal backdrop itself, not the content
        if (e.target.classList.contains('modal')) {
            closeSettings();
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
            closeSettings();
        }
    });

    // Save query when user clicks out of textarea
    queryTextarea.addEventListener('blur', saveSettings);

    // Allow Ctrl+Enter to submit
    queryTextarea.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            handleSubmit();
        }
    });

    // Setup lazy loading
    setupLazyLoading();

    console.log('XofY OSM Geometry Viewer initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
