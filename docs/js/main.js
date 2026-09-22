/**
 * main.js
 * Main application entry point
 * Coordinates the flow between all modules
 */

import { executeQuery, DEFAULT_OVERPASS_URL } from './overpassClient.js';
import { parseElements } from './geometryParser.js';
import { getGlobalBounds } from './boundingBox.js';
import { createGrid, getCanvases, appendBatch, sortTagKeys } from './gridLayout.js';
import { renderGeometry } from './canvasRenderer.js';
import { reprojectBounds } from './reproject.js';
import { buildShareURL, decodeParamsToState } from './utils/sharing.js';
import { createSearchTab, loadStoredSelection } from './ui/searchTab.js';

// DOM elements
const queryTextarea = document.getElementById('overpass-query');
const submitBtn = document.getElementById('submit-btn');
const curatedSubmitBtn = document.getElementById('curated-submit-btn');
const featureComboboxRoot = document.getElementById('feature-combobox');
const areaComboboxRoot = document.getElementById('area-combobox');
const sortSelect = document.getElementById('sort-select');
const scaleToggle = document.getElementById('scale-toggle');
const fillColorInput = document.getElementById('fill-color');
const respectOsmColorsToggle = document.getElementById('respect-osm-colors');
const overpassServerSelect = document.getElementById('overpass-server-select');
const overpassCustomUrlInput = document.getElementById('overpass-custom-url');
const customUrlGroup = document.getElementById('custom-url-group');
const themeToggle = document.getElementById('theme-toggle');
const themeIconLight = document.getElementById('theme-icon-light');
const themeIconDark = document.getElementById('theme-icon-dark');
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
const groupByTagInput = document.getElementById('group-by-tag');
const shareBtn = document.getElementById('share-btn');
const geojsonImport = document.getElementById('geojson-import');
const importFileLabel = document.getElementById('import-file-label');
const importBtn = document.getElementById('import-btn');
const importGroupByTagInput = document.getElementById('import-group-by-tag');
const displayPanel = document.querySelector('.display-panel');
const displayPanelToggle = document.getElementById('display-panel-toggle');

// Tab elements
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Detail modal elements
const detailModal = document.getElementById('detail-modal');
const detailCanvas = document.getElementById('detail-canvas');
const detailLinks = document.getElementById('detail-links');
const detailTags = document.getElementById('detail-tags');
const detailCounter = document.getElementById('detail-counter');
const detailPrevBtn = document.getElementById('detail-prev');
const detailNextBtn = document.getElementById('detail-next');
const closeDetailBtn = document.getElementById('close-detail');

// Preview tooltip elements
const previewTooltip = document.getElementById('preview-tooltip');
const previewCanvas = document.getElementById('preview-canvas');

// Application state
let currentGeometries = [];
let currentGlobalBounds = null;
let currentMaxDimension = null;
let currentFillColor = '#3388ff';
let currentOverpassUrl = DEFAULT_OVERPASS_URL;
let respectOsmColors = true; // Default to respecting OSM colours
let currentTheme = null; // Track current theme ('light' or 'dark')

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

// Detail modal state
let detailModalState = {
    currentIndex: 0,
    isOpen: false
};

// Preview tooltip state
let previewState = {
    hoverTimeout: null,
    currentIndex: -1
};

/**
 * How many features a search may match before the viewer warns instead of
 * drawing them. The grid appends 50 items at a time and never drops what it has
 * drawn, and every item is a 200px canvas scaled by devicePixelRatio (around
 * 640 KB of backing store each on a 2x screen), so a few thousand items is
 * already a gigabyte of canvas and dozens of scroll batches. The spec's own
 * example of an enormous result - 4,955 swimming pools in Nice - sits above it.
 */
const MAX_UNWARNED_RESULTS = 2000;

// Tab state
let currentTab = 'curated';

// The Search tab controller (created during init)
let searchTab = null;

// Guards the Search tab's count-then-run flow: one at a time, and a result
// that arrives after the selection changed is dropped
let searchSubmitBusy = false;
let searchSubmitToken = 0;
let pendingWarning = null;

// The grouping hint the Search tab last wrote. A curated feature still sets the
// hint as it always has; this only decides whether a later free-form search may
// clear it, which it does unless the user has since edited it themselves.
let appliedGroupBy = null;

// Pending import file (for two-step import flow)
let pendingImportFile = null;

// LocalStorage keys
const STORAGE_KEYS = {
    QUERY: 'xofy-osm-query',
    FILL_COLOR: 'xofy-osm-fill-color',
    SCALE_TOGGLE: 'xofy-osm-scale-toggle',
    OVERPASS_URL: 'xofy-osm-overpass-url',
    THEME: 'xofy-osm-theme',
    GROUP_BY_TAG: 'xofy-osm-group-by-tag',
    RESPECT_OSM_COLORS: 'xofy-osm-respect-osm-colors',
    SORT_BY: 'xofy-osm-sort-by'
};

/**
 * Apply theme to document and update icon
 * @param {string} theme - 'light' or 'dark'
 */
function applyTheme(theme) {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);

    // Update icon visibility - show sun in dark mode (to switch to light), moon in light mode (to switch to dark)
    if (theme === 'dark') {
        themeIconLight.classList.remove('hidden');
        themeIconDark.classList.add('hidden');
    } else {
        themeIconLight.classList.add('hidden');
        themeIconDark.classList.remove('hidden');
    }
}

/**
 * Get effective theme based on system preference
 * @returns {string} 'light' or 'dark'
 */
function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Switch to a specific tab
 * @param {string} tabName - The tab to switch to ('curated', 'overpass', or 'import')
 */
function switchTab(tabName) {
    currentTab = tabName;

    // A size warning belongs to the Search tab's current selection
    dismissCountWarning();

    // Update tab button states
    tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update tab content visibility
    tabContents.forEach(content => {
        if (content.dataset.tab === tabName) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    // Show/hide header buttons based on tab
    // Share and settings only work for curated and overpass tabs
    if (tabName === 'import') {
        shareBtn.classList.add('hidden');
        settingsBtn.classList.add('hidden');
    } else {
        shareBtn.classList.remove('hidden');
        settingsBtn.classList.remove('hidden');
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
        localStorage.setItem(STORAGE_KEYS.THEME, currentTheme);
        localStorage.setItem(STORAGE_KEYS.GROUP_BY_TAG, groupByTagInput.value.trim());
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
        query: '',
        fillColor: '#3388ff',
        scaleToggle: false,
        overpassUrl: 'https://overpass.private.coffee/api/interpreter',
        theme: null, // null means use system preference
        groupByTag: '',
        respectOsmColors: true,
        sortBy: 'nodes-desc'
    };

    try {
        const savedQuery = localStorage.getItem(STORAGE_KEYS.QUERY);
        const savedFillColor = localStorage.getItem(STORAGE_KEYS.FILL_COLOR);
        const savedScaleToggle = localStorage.getItem(STORAGE_KEYS.SCALE_TOGGLE);
        const savedOverpassUrl = localStorage.getItem(STORAGE_KEYS.OVERPASS_URL);
        const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
        const savedGroupByTag = localStorage.getItem(STORAGE_KEYS.GROUP_BY_TAG);
        const savedRespectOsmColors = localStorage.getItem(STORAGE_KEYS.RESPECT_OSM_COLORS);
        const savedSortBy = localStorage.getItem(STORAGE_KEYS.SORT_BY);

        return {
            query: savedQuery || defaults.query,
            fillColor: savedFillColor || defaults.fillColor,
            scaleToggle: savedScaleToggle === 'true',
            overpassUrl: savedOverpassUrl || defaults.overpassUrl,
            theme: savedTheme || defaults.theme,
            groupByTag: savedGroupByTag !== null ? savedGroupByTag : defaults.groupByTag,
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
function showLoading(message) {
    const text = loadingDiv.querySelector('p');
    if (text) {
        text.textContent = message || 'Loading geometries...';
    }

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

        // Setup hover preview listeners for new items
        setupPreviewListeners();

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

    // Setup hover preview listeners for new items
    setupPreviewListeners();

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
    return runQuery(queryTextarea.value.trim());
}

/**
 * Execute an Overpass query and render what comes back
 * @param {string} query - The Overpass QL to run
 */
async function runQuery(query) {
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
        const groupByTag = groupByTagInput.value.trim();
        const parseOptions = {
            groupByEnabled: groupByTag.length > 0,
            groupByTag: groupByTag || 'name'
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

        // Setup hover preview listeners
        setupPreviewListeners();

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
 * Handle theme toggle button click
 */
function handleThemeToggle() {
    // Toggle between light and dark
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
    saveSettings();
}

/**
 * Handle group by tag input change
 */
function handleGroupByTagChange() {
    // From now on this is the user's hint, not one a curated feature set
    appliedGroupBy = null;
    saveSettings();
}

/**
 * Update the Overpass submit button enabled state based on query content
 */
function updateOverpassSubmitState() {
    const hasQuery = queryTextarea.value.trim().length > 0;
    submitBtn.disabled = !hasQuery;
}

/**
 * Collect the shareable state from the UI
 * @returns {Object} State for utils/sharing.js
 */
function getShareableState() {
    const selection = searchTab ? searchTab.getState() : {};

    return {
        tab: currentTab,
        feature: selection.feature,
        x: selection.x,
        xLabel: selection.xLabel,
        xElementTypes: selection.xElementTypes,
        area: selection.area,
        y: selection.y,
        yLabel: selection.yLabel,
        query: queryTextarea.value,
        fillColor: fillColorInput.value,
        scaleToggle: scaleToggle.checked,
        groupByTag: groupByTagInput.value
    };
}

/**
 * Encode current state to URL parameters
 * @returns {string} URL with encoded parameters
 */
function encodeStateToURL() {
    return buildShareURL(getShareableState(), window.location.href);
}

/**
 * Decode URL parameters and apply to state
 * @returns {Object|null} Decoded state or null if no parameters
 */
function decodeURLParams() {
    return decodeParamsToState(window.location.search);
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
 * Handle GeoJSON file selection (step 1 of two-step import)
 */
function handleGeojsonFileSelect(event) {
    const file = event.target.files[0];
    if (!file) {
        pendingImportFile = null;
        importFileLabel.textContent = 'Choose GeoJSON file...';
        importBtn.disabled = true;
        document.querySelector('.import-file-btn').classList.remove('has-file');
        return;
    }

    // Store the file for later import
    pendingImportFile = file;
    importFileLabel.textContent = file.name;
    importBtn.disabled = false;
    document.querySelector('.import-file-btn').classList.add('has-file');
}

/**
 * Handle Import button click (step 2 of two-step import)
 */
async function handleImportSubmit() {
    if (!pendingImportFile) {
        showError('Please select a GeoJSON file first');
        return;
    }

    try {
        showLoading();

        const text = await pendingImportFile.text();
        const geojson = JSON.parse(text);

        // Convert GeoJSON to Overpass element format, then parse with merging logic
        const elements = convertGeoJsonToElements(geojson);

        if (elements.length === 0) {
            hideLoading();
            showError('No valid geometries found in GeoJSON file');
            return;
        }

        // Parse elements with grouping options from IMPORT tab controls
        const groupByTag = importGroupByTagInput.value.trim();
        const parseOptions = {
            groupByEnabled: groupByTag.length > 0,
            groupByTag: groupByTag || 'name'
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

        // Setup hover preview listeners
        setupPreviewListeners();

        hideLoading();

        // Reset import state after successful import
        pendingImportFile = null;
        geojsonImport.value = '';
        importFileLabel.textContent = 'Choose GeoJSON file...';
        importBtn.disabled = true;
        document.querySelector('.import-file-btn').classList.remove('has-file');

    } catch (error) {
        hideLoading();
        console.error('GeoJSON import error:', error);
        showError(`Failed to load GeoJSON: ${error.message}`);
    }
}


/**
 * Sync a query built on the Search tab into the Overpass tab
 * @param {string} query - The Overpass QL query
 * @param {string|null} groupBy - Grouping hint to apply, or null to leave the
 *     user's own value alone (free-form searches have no hint of their own)
 */
function handleSearchQueryChange(query, groupBy) {
    queryTextarea.value = query;

    if (groupBy !== null) {
        groupByTagInput.value = groupBy;
        appliedGroupBy = groupBy;
    } else if (appliedGroupBy !== null && groupByTagInput.value === appliedGroupBy) {
        // The hint came from the curated feature we are leaving, not from the
        // user, so it must not follow them into a free-form search
        groupByTagInput.value = '';
        appliedGroupBy = null;
    }

    // Update Overpass submit button state since query changed
    updateOverpassSubmitState();
    saveSettings();
}

/**
 * Clear what the last search drew, so a message about the next one does not
 * appear above stale results
 */
function clearResults() {
    cleanupLazyLoading();
    currentGeometries = [];
    gridContainer.innerHTML = '';
    statsDiv.classList.add('hidden');
}

/**
 * Read the total out of an `out count;` response
 * @param {Object} data - Overpass JSON response
 * @returns {number|null} The total, or null when the response has no count
 */
function readCount(data) {
    const element = data && Array.isArray(data.elements) ? data.elements[0] : null;
    const total = element && element.tags ? Number(element.tags.total) : NaN;
    return Number.isFinite(total) ? total : null;
}

/**
 * Escape text that is about to go into innerHTML
 * @param {string} text - Raw text, possibly from a server
 * @returns {string} Text safe to interpolate
 */
function escapeHtml(text) {
    const holder = document.createElement('span');
    holder.textContent = String(text ?? '');
    return holder.innerHTML;
}

/**
 * Show a message about a search that was not run, with a button that runs the
 * exact query it was raised for
 * @param {string} html - The message body
 * @param {string} query - The query "Run anyway" should execute
 */
function showRunAnywayMessage(html, query, kind = 'warning') {
    // Too many results is not a failure, so it uses the neutral block; a count
    // that could not be run is an error and stays red
    const target = kind === 'warning' ? warningsDiv : errorDiv;

    target.innerHTML = `${html}
        <button type="button" class="submit-btn" id="run-anyway-btn">Run anyway</button>
    `;
    target.classList.remove('hidden');
    pendingWarning = target;
    target.scrollIntoView({ block: 'nearest' });

    const runAnyway = document.getElementById('run-anyway-btn');
    if (runAnyway) {
        // The captured query, not whatever the textarea holds by now
        runAnyway.addEventListener('click', () => {
            dismissCountWarning();
            runQuery(query);
        });
    }
}

/**
 * Take down a size warning, because it referred to a selection that has since
 * changed (or to a tab the user has left)
 */
function dismissCountWarning() {
    // Whatever count is in flight is about the selection as it was
    searchSubmitToken++;

    if (!pendingWarning) {
        return;
    }
    pendingWarning.innerHTML = '';
    pendingWarning.classList.add('hidden');
    pendingWarning = null;
}

/**
 * Run a query from the Search tab, sizing it first when it could be enormous
 * @param {Object} plan - {query, countQuery, needsCount} from the Search tab
 */
async function handleSearchSubmit(plan) {
    // One run at a time: a second click must not start a second pair of queries
    if (!plan || searchSubmitBusy) {
        return;
    }

    dismissCountWarning();

    const token = ++searchSubmitToken;
    searchSubmitBusy = true;
    curatedSubmitBtn.disabled = true;

    try {
        if (!plan.needsCount || !plan.countQuery) {
            await runQuery(plan.query);
            return;
        }

        // Whatever the last search drew is no longer what the page is about
        clearResults();
        showLoading('Checking how many features match...');

        let total;
        try {
            total = readCount(await executeQuery(plan.countQuery, currentOverpassUrl));
        } catch (error) {
            console.error('Count query failed:', error);
            hideLoading();

            if (token === searchSubmitToken) {
                showRunAnywayMessage(
                    `<strong>Could not check the size of this search</strong>
                    <p>${escapeHtml(error.message)}</p>
                    <p class="suggestion">💡 The search itself may still work, but it could be very large.</p>`,
                    plan.query,
                    'error'
                );
            }
            return;
        }

        hideLoading();

        // The selection changed while the count was in flight
        if (token !== searchSubmitToken) {
            return;
        }

        if (total === null) {
            // Nothing to go on, so run it rather than block the user
            await runQuery(plan.query);
            return;
        }

        if (total === 0) {
            showError('No features match - check the feature and the area. If the area was only added to OpenStreetMap recently, Overpass may not have built its boundary yet.');
            errorDiv.scrollIntoView({ block: 'nearest' });
            return;
        }

        if (total > MAX_UNWARNED_RESULTS) {
            showRunAnywayMessage(
                `<strong>That is a lot of features</strong>
                <p>This search matches ${total.toLocaleString()} features. Drawing that many will make the page very slow.</p>
                <p class="suggestion">💡 Try a smaller area, or narrow the feature down.</p>`,
                plan.query
            );
            return;
        }

        await runQuery(plan.query);
    } finally {
        searchSubmitBusy = false;
        // The selection may have changed while this ran
        curatedSubmitBtn.disabled = !(searchTab && searchTab.isReady());
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
 * Toggle display panel expand/collapse
 */
function toggleDisplayPanel() {
    displayPanel.classList.toggle('collapsed');
}

// ==========================================
// Hover Preview Tooltip Functions
// ==========================================

/**
 * Show the preview tooltip for a geometry
 * @param {number} index - Index of the geometry to preview
 * @param {number} x - X position (clientX)
 * @param {number} y - Y position (clientY)
 */
function showPreviewTooltip(index, x, y) {
    if (index < 0 || index >= currentGeometries.length) return;
    if (detailModalState.isOpen) return; // Don't show preview if modal is open

    const geom = currentGeometries[index];
    previewState.currentIndex = index;

    // Setup canvas with HiDPI scaling
    const displaySize = 400;
    const dpr = window.devicePixelRatio || 1;
    previewCanvas.width = displaySize * dpr;
    previewCanvas.height = displaySize * dpr;
    previewCanvas.style.width = displaySize + 'px';
    previewCanvas.style.height = displaySize + 'px';

    // Render geometry
    const renderOptions = {
        maintainRelativeSize: scaleToggle.checked,
        maxDimension: currentMaxDimension,
        fillColor: currentFillColor,
        respectOsmColors
    };
    renderGeometry(previewCanvas, geom, renderOptions);

    // Position tooltip near cursor, clamped to viewport
    const tooltipWidth = 416; // 400 + padding
    const tooltipHeight = 416;
    let tooltipX = x + 20;
    let tooltipY = y - tooltipHeight / 2;

    // Clamp to viewport
    tooltipX = Math.min(tooltipX, window.innerWidth - tooltipWidth - 10);
    tooltipX = Math.max(10, tooltipX);
    tooltipY = Math.max(10, Math.min(tooltipY, window.innerHeight - tooltipHeight - 10));

    previewTooltip.style.left = tooltipX + 'px';
    previewTooltip.style.top = tooltipY + 'px';

    // Show tooltip
    previewTooltip.classList.remove('hidden');
}

/**
 * Hide the preview tooltip
 */
function hidePreviewTooltip() {
    previewTooltip.classList.add('hidden');
    previewState.currentIndex = -1;
}

/**
 * Handle mouse enter on geometry item
 * @param {MouseEvent} event
 */
function handleGeometryMouseEnter(event) {
    const item = event.currentTarget;
    const index = parseInt(item.dataset.index);

    // Clear any existing timeout
    if (previewState.hoverTimeout) {
        clearTimeout(previewState.hoverTimeout);
    }

    // Set timeout for 300ms delay
    previewState.hoverTimeout = setTimeout(() => {
        showPreviewTooltip(index, event.clientX, event.clientY);
    }, 300);
}

/**
 * Handle mouse leave on geometry item
 */
function handleGeometryMouseLeave() {
    // Clear timeout if we leave before it fires
    if (previewState.hoverTimeout) {
        clearTimeout(previewState.hoverTimeout);
        previewState.hoverTimeout = null;
    }
    hidePreviewTooltip();
}

/**
 * Handle mouse move on geometry item (update tooltip position)
 * @param {MouseEvent} event
 */
function handleGeometryMouseMove(event) {
    if (previewState.currentIndex === -1) return;

    // Update tooltip position
    const tooltipWidth = 416;
    const tooltipHeight = 416;
    let tooltipX = event.clientX + 20;
    let tooltipY = event.clientY - tooltipHeight / 2;

    // Clamp to viewport
    tooltipX = Math.min(tooltipX, window.innerWidth - tooltipWidth - 10);
    tooltipX = Math.max(10, tooltipX);
    tooltipY = Math.max(10, Math.min(tooltipY, window.innerHeight - tooltipHeight - 10));

    previewTooltip.style.left = tooltipX + 'px';
    previewTooltip.style.top = tooltipY + 'px';
}

// ==========================================
// Detail Modal Functions
// ==========================================

/**
 * Calculate centroid of bounding box (copied from gridLayout for modal use)
 */
function calculateCentroid(bounds) {
    return {
        lat: (bounds.minLat + bounds.maxLat) / 2,
        lon: (bounds.minLon + bounds.maxLon) / 2
    };
}

/**
 * Calculate OSM zoom level (copied from gridLayout for modal use)
 */
function calculateZoomLevel(bounds) {
    const maxExtent = Math.max(bounds.width, bounds.height);
    if (maxExtent > 10) return 6;
    if (maxExtent > 5) return 7;
    if (maxExtent > 2) return 8;
    if (maxExtent > 1) return 9;
    if (maxExtent > 0.5) return 10;
    if (maxExtent > 0.25) return 11;
    if (maxExtent > 0.1) return 12;
    if (maxExtent > 0.05) return 13;
    if (maxExtent > 0.02) return 14;
    if (maxExtent > 0.01) return 15;
    if (maxExtent > 0.005) return 16;
    if (maxExtent > 0.002) return 17;
    if (maxExtent > 0.001) return 18;
    return 19;
}

/**
 * Render the detail modal for a specific geometry index
 * @param {number} index - Index of geometry to display
 */
function renderDetailModal(index) {
    if (index < 0 || index >= currentGeometries.length) return;

    const geom = currentGeometries[index];
    detailModalState.currentIndex = index;

    // Update counter
    detailCounter.textContent = `${index + 1} of ${currentGeometries.length}`;

    // Update nav button states
    detailPrevBtn.disabled = index === 0;
    detailNextBtn.disabled = index === currentGeometries.length - 1;

    // Setup canvas - responsive size based on container
    const container = detailCanvas.parentElement;
    const containerRect = container.getBoundingClientRect();
    const maxSize = Math.min(containerRect.width - 40, containerRect.height - 40, 600);
    const displaySize = Math.max(300, maxSize);
    const dpr = window.devicePixelRatio || 1;

    detailCanvas.width = displaySize * dpr;
    detailCanvas.height = displaySize * dpr;
    detailCanvas.style.width = displaySize + 'px';
    detailCanvas.style.height = displaySize + 'px';

    // Render geometry
    const renderOptions = {
        maintainRelativeSize: scaleToggle.checked,
        maxDimension: currentMaxDimension,
        fillColor: currentFillColor,
        respectOsmColors
    };
    renderGeometry(detailCanvas, geom, renderOptions);

    // Build links section
    let linksHtml = '';
    const isImported = lazyLoadState.isImported;

    if (!isImported) {
        if (geom.type === 'component') {
            // Component: link to map view centered on component
            const centroid = calculateCentroid(geom.bounds);
            const zoom = calculateZoomLevel(geom.bounds);
            linksHtml += `<a href="https://www.openstreetmap.org/#map=${zoom}/${centroid.lat.toFixed(6)}/${centroid.lon.toFixed(6)}" target="_blank" rel="noopener noreferrer">${geom.sourceWayIds.length} Connected Ways</a>`;

            // JOSM link for all constituent ways
            const objects = geom.sourceWayIds.map(id => `w${id}`).join(',');
            linksHtml += `<a href="#" class="josm-link" data-josm-url="http://127.0.0.1:8111/load_object?objects=${objects}">Open in JOSM</a>`;
        } else {
            // Way or relation
            const displayType = geom.type.charAt(0).toUpperCase() + geom.type.slice(1);
            linksHtml += `<a href="https://www.openstreetmap.org/${geom.type}/${geom.id}" target="_blank" rel="noopener noreferrer">OSM ${displayType} ${geom.id}</a>`;

            // JOSM link
            const josmUrl = `http://127.0.0.1:8111/load_object?objects=${geom.type.charAt(0)}${geom.id}`;
            linksHtml += `<a href="#" class="josm-link" data-josm-url="${josmUrl}">Open in JOSM</a>`;
        }
    } else {
        // Imported data - just show type info
        if (geom.type === 'component') {
            linksHtml += `<span>${geom.sourceWayIds.length} Connected Ways</span>`;
        } else {
            const displayType = geom.type.charAt(0).toUpperCase() + geom.type.slice(1);
            linksHtml += `<span>${displayType} ${geom.id}</span>`;
        }
    }

    detailLinks.innerHTML = linksHtml;

    // Add click handlers for JOSM links
    detailLinks.querySelectorAll('.josm-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const josmUrl = link.dataset.josmUrl;
            fetch(josmUrl).catch(() => {
                // Silently fail if JOSM is not running
            });
        });
    });

    // Build tags section (with internal _tags at the end)
    let tagsHtml = '';
    const allTags = sortTagKeys(Object.keys(geom.tags));
    allTags.forEach(key => {
        tagsHtml += `<div class="tag-item"><span class="tag-key">${key}</span><span class="tag-value">${geom.tags[key]}</span></div>`;
    });

    if (allTags.length === 0) {
        tagsHtml = '<div class="tag-item"><span class="tag-value" style="color: var(--text-secondary); font-style: italic;">No tags</span></div>';
    }

    detailTags.innerHTML = tagsHtml;
}

/**
 * Open the detail modal for a specific geometry
 * @param {number} index - Index of geometry to display
 */
function openDetailModal(index) {
    if (currentGeometries.length === 0) return;

    // Hide preview tooltip if showing
    hidePreviewTooltip();

    detailModalState.isOpen = true;
    detailModal.classList.remove('hidden');

    // Render after modal is visible so we can measure container
    requestAnimationFrame(() => {
        renderDetailModal(index);
    });
}

/**
 * Close the detail modal
 */
function closeDetailModal() {
    detailModalState.isOpen = false;
    detailModal.classList.add('hidden');
}

/**
 * Show previous geometry in detail modal
 */
function showPrevGeometry() {
    if (detailModalState.currentIndex > 0) {
        renderDetailModal(detailModalState.currentIndex - 1);
    }
}

/**
 * Show next geometry in detail modal
 */
function showNextGeometry() {
    if (detailModalState.currentIndex < currentGeometries.length - 1) {
        renderDetailModal(detailModalState.currentIndex + 1);
    }
}

/**
 * Setup hover preview listeners on geometry items
 * Called after grid is created/updated
 */
function setupPreviewListeners() {
    const items = gridContainer.querySelectorAll('.geometry-item');
    items.forEach(item => {
        // Remove old listeners to avoid duplicates (simple approach)
        item.removeEventListener('mouseenter', handleGeometryMouseEnter);
        item.removeEventListener('mouseleave', handleGeometryMouseLeave);
        item.removeEventListener('mousemove', handleGeometryMouseMove);

        // Add fresh listeners
        item.addEventListener('mouseenter', handleGeometryMouseEnter);
        item.addEventListener('mouseleave', handleGeometryMouseLeave);
        item.addEventListener('mousemove', handleGeometryMouseMove);
    });
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
    // Set initial theme (use saved or fall back to system preference)
    currentTheme = settings.theme || getSystemTheme();
    groupByTagInput.value = finalSettings.groupByTag;
    sortSelect.value = settings.sortBy; // Sort preference persists
    currentFillColor = finalSettings.fillColor;
    respectOsmColors = finalSettings.respectOsmColors;
    currentOverpassUrl = settings.overpassUrl; // Overpass URL not shared

    // Set initial state of Overpass submit button
    updateOverpassSubmitState();

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
    applyTheme(currentTheme);

    // A URL selection needs both halves: a curated or free-form feature, and a
    // curated or searched area
    const urlSelection = urlParams && (urlParams.feature || urlParams.x) && (urlParams.area || urlParams.y)
        ? urlParams
        : null;

    // Determine initial tab based on URL parameters
    if (urlSelection) {
        // If URL has a selection, set up the Search tab and stay there
        switchTab('curated');
    } else if (urlParams && urlParams.query) {
        // If URL has a query parameter, start on Overpass tab
        switchTab('overpass');
    } else {
        // Default to Curated tab
        switchTab('curated');
    }

    // Tab navigation event listeners
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    // Import tab event listeners
    geojsonImport.addEventListener('change', handleGeojsonFileSelect);
    importBtn.addEventListener('click', handleImportSubmit);

    // Search tab: two comboboxes and the query wiring behind them
    searchTab = createSearchTab({
        featureRoot: featureComboboxRoot,
        areaRoot: areaComboboxRoot,
        submitButton: curatedSubmitBtn,
        onQueryChange: handleSearchQueryChange,
        onSubmit: handleSearchSubmit,
        onSelectionChange: dismissCountWarning,
        onError: showError
    });

    if (urlSelection) {
        // A shared link rebuilds its query
        searchTab.applyState(urlSelection);
    } else {
        // Restore the last selection, but leave the query textarea as the user
        // left it - it is saved separately and may have been edited by hand
        searchTab.applyState(loadStoredSelection(), { buildQuery: false });
    }

    // Event listeners
    submitBtn.addEventListener('click', handleSubmit);
    sortSelect.addEventListener('change', handleSortChange);
    scaleToggle.addEventListener('change', handleScaleToggle);
    fillColorInput.addEventListener('input', handleFillColorChange);
    respectOsmColorsToggle.addEventListener('change', handleRespectOsmColorsToggle);
    overpassServerSelect.addEventListener('change', handleOverpassServerChange);
    overpassCustomUrlInput.addEventListener('blur', handleOverpassCustomUrlChange);
    themeToggle.addEventListener('click', handleThemeToggle);
    groupByTagInput.addEventListener('blur', handleGroupByTagChange);
    backToTopBtn.addEventListener('click', handleBackToTop);
    shareBtn.addEventListener('click', handleShare);

    // Ensure modal is hidden on startup
    settingsModal.classList.add('hidden');

    // Display panel toggle
    displayPanelToggle.addEventListener('click', toggleDisplayPanel);

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

    // Detail modal event listeners
    closeDetailBtn.addEventListener('click', closeDetailModal);
    detailPrevBtn.addEventListener('click', showPrevGeometry);
    detailNextBtn.addEventListener('click', showNextGeometry);

    // Close detail modal when clicking on backdrop
    detailModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeDetailModal();
        }
    });

    // Keyboard navigation for detail modal
    document.addEventListener('keydown', (e) => {
        if (!detailModal.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                closeDetailModal();
            } else if (e.key === 'ArrowLeft') {
                showPrevGeometry();
            } else if (e.key === 'ArrowRight') {
                showNextGeometry();
            }
        }
    });

    // Zoom button click handler (custom event from gridLayout.js)
    gridContainer.addEventListener('geometry-zoom', (e) => {
        openDetailModal(e.detail.index);
    });

    // Save query when user clicks out of textarea
    queryTextarea.addEventListener('blur', saveSettings);

    // Update submit button state as user types
    queryTextarea.addEventListener('input', updateOverpassSubmitState);

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
