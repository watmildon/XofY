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

// DOM elements
const queryTextarea = document.getElementById('overpass-query');
const submitBtn = document.getElementById('submit-btn');
const exampleSelect = document.getElementById('example-select');
const scaleToggle = document.getElementById('scale-toggle');
const fillColorInput = document.getElementById('fill-color');
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
rel["type"="boundary"]["name"="Sydney"]["admin_level"="8"];
map_to_area->.searchArea;
wr(area.searchArea)[leisure=track][!athletics];
out geom;`
    }
};

// Application state
let currentGeometries = [];
let currentGlobalBounds = null;
let currentMaxDimension = null;
let currentFillColor = '#3388ff';
let currentOverpassUrl = DEFAULT_OVERPASS_URL;

// Lazy loading state
let lazyLoadState = {
    enabled: false,
    renderedCount: 0,
    totalCount: 0,
    isLoading: false,
    batchSize: 50,
    loadThreshold: 300 // pixels from bottom
};

// LocalStorage keys
const STORAGE_KEYS = {
    QUERY: 'xofy-osm-query',
    FILL_COLOR: 'xofy-osm-fill-color',
    SCALE_TOGGLE: 'xofy-osm-scale-toggle',
    OVERPASS_URL: 'xofy-osm-overpass-url',
    THEME: 'xofy-osm-theme',
    GROUP_BY_ENABLED: 'xofy-osm-group-by-enabled',
    GROUP_BY_TAG: 'xofy-osm-group-by-tag'
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
        groupByTag: 'name'
    };

    try {
        const savedQuery = localStorage.getItem(STORAGE_KEYS.QUERY);
        const savedFillColor = localStorage.getItem(STORAGE_KEYS.FILL_COLOR);
        const savedScaleToggle = localStorage.getItem(STORAGE_KEYS.SCALE_TOGGLE);
        const savedOverpassUrl = localStorage.getItem(STORAGE_KEYS.OVERPASS_URL);
        const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
        const savedGroupByEnabled = localStorage.getItem(STORAGE_KEYS.GROUP_BY_ENABLED);
        const savedGroupByTag = localStorage.getItem(STORAGE_KEYS.GROUP_BY_TAG);

        return {
            query: savedQuery || defaults.query,
            fillColor: savedFillColor || defaults.fillColor,
            scaleToggle: savedScaleToggle === 'true',
            overpassUrl: savedOverpassUrl || defaults.overpassUrl,
            theme: savedTheme || defaults.theme,
            groupByEnabled: savedGroupByEnabled === 'true',
            groupByTag: savedGroupByTag || defaults.groupByTag
        };
    } catch (e) {
        console.warn('Failed to load settings from localStorage:', e);
        return defaults;
    }
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
 * @param {Array<Object>} warnings - Array of warning objects with message, osmType, and osmId
 */
function showWarnings(warnings) {
    if (warnings.length === 0) {
        warningsDiv.classList.add('hidden');
        return;
    }

    // Helper function to format a warning with clickable OSM link
    function formatWarning(warning) {
        if (!warning.osmType || !warning.osmId) {
            // Fallback for any legacy string warnings
            return typeof warning === 'string' ? warning : warning.message;
        }

        const osmUrl = `https://www.openstreetmap.org/${warning.osmType}/${warning.osmId}`;
        const message = warning.message;

        // Replace the OSM ID in the message with a clickable link
        const idPattern = new RegExp(`(${warning.osmType}\\s+)(${warning.osmId})`, 'i');
        const linkedMessage = message.replace(
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
        fillColor: currentFillColor
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
        fillColor: currentFillColor
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
        appendBatch(gridContainer, currentGeometries, startIndex, endIndex);

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
        currentGeometries = geometries;

        // Find the largest dimension (for relative size scaling)
        currentMaxDimension = Math.max(
            ...geometries.map(geom => Math.max(geom.bounds.width, geom.bounds.height))
        );

        // Show statistics
        showStats(
            data.elements ? data.elements.length : 0,
            geometries,
            warnings.length
        );

        // Create grid with lazy loading support
        const gridResult = createGrid(gridContainer, geometries, {
            initialBatch: 50,
            lazyLoadThreshold: 100
        });

        // Update lazy loading state
        lazyLoadState.enabled = gridResult.isLazyLoaded;
        lazyLoadState.renderedCount = gridResult.renderedCount;
        lazyLoadState.totalCount = gridResult.totalCount;

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
    // Load saved settings
    const settings = loadSettings();

    // Apply saved settings to UI
    queryTextarea.value = settings.query;
    fillColorInput.value = settings.fillColor;
    scaleToggle.checked = settings.scaleToggle;
    themeSelect.value = settings.theme;
    groupByToggle.checked = settings.groupByEnabled;
    groupByTagInput.value = settings.groupByTag;
    currentFillColor = settings.fillColor;
    currentOverpassUrl = settings.overpassUrl;

    // Show/hide group by tag input based on toggle
    if (settings.groupByEnabled) {
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

    // Event listeners
    submitBtn.addEventListener('click', handleSubmit);
    exampleSelect.addEventListener('change', handleExampleSelect);
    scaleToggle.addEventListener('change', handleScaleToggle);
    fillColorInput.addEventListener('input', handleFillColorChange);
    overpassServerSelect.addEventListener('change', handleOverpassServerChange);
    overpassCustomUrlInput.addEventListener('blur', handleOverpassCustomUrlChange);
    themeSelect.addEventListener('change', handleThemeChange);
    groupByToggle.addEventListener('change', handleGroupByToggle);
    groupByTagInput.addEventListener('blur', handleGroupByTagChange);
    backToTopBtn.addEventListener('click', handleBackToTop);

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
