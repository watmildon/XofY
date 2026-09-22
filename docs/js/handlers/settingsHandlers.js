/**
 * settingsHandlers.js
 * The display and server settings: applying them on load, reacting when they
 * change, and saving them to localStorage
 */

import { DEFAULT_OVERPASS_URL } from '../overpassClient.js';
import { state, storeSettings, normaliseBackend, PREDEFINED_SERVERS } from '../state/appState.js';
import { renderAllGeometries, buildGrid } from '../utils/rendering.js';
import { cleanupLazyLoading } from '../utils/lazyLoading.js';
import { sortGeometries } from '../utils/sorting.js';
import { applyTheme, getSystemTheme, getTheme, toggleTheme } from '../ui/theme.js';
import { getQueryLang } from '../ui/queryTab.js';

const queryTextarea = document.getElementById('overpass-query');
const sortSelect = document.getElementById('sort-select');
const scaleToggle = document.getElementById('scale-toggle');
const fillColorInput = document.getElementById('fill-color');
const respectOsmColorsToggle = document.getElementById('respect-osm-colors');
const overpassServerSelect = document.getElementById('overpass-server-select');
const overpassCustomUrlInput = document.getElementById('overpass-custom-url');
const customUrlGroup = document.getElementById('custom-url-group');
const overpassServerGroup = document.getElementById('overpass-server-group');
const backendSelect = document.getElementById('backend-select');
const themeToggle = document.getElementById('theme-toggle');
const groupByTagInput = document.getElementById('group-by-tag');

// Called with the new backend when the data source changes
let onBackendChange = null;

/**
 * Get the current Overpass URL from the UI
 * @returns {string} The current Overpass URL
 */
export function getCurrentOverpassUrl() {
    const selectedValue = overpassServerSelect.value;
    if (selectedValue === 'custom') {
        return overpassCustomUrlInput.value.trim() || DEFAULT_OVERPASS_URL;
    }
    return selectedValue;
}

/**
 * The sort order chosen in the display options
 * @returns {string} A sortGeometries() order
 */
export function getSortBy() {
    return sortSelect.value;
}

/**
 * The data source chosen in the settings
 * @returns {string} 'postpass' or 'overpass'
 */
function getCurrentBackend() {
    return normaliseBackend(backendSelect.value);
}

/**
 * Show the Overpass server controls only when Overpass is what runs the
 * queries. They are not wrong on Postpass, just about nothing on the screen.
 * @param {string} backend - The backend now selected
 */
function applyBackendVisibility(backend) {
    const usesOverpass = backend === 'overpass';

    overpassServerGroup.classList.toggle('hidden', !usesOverpass);
    // The custom URL box is inside the Overpass half, so it hides with it and
    // only reappears when "Custom URL..." is what the server select says
    customUrlGroup.classList.toggle(
        'hidden',
        !usesOverpass || overpassServerSelect.value !== 'custom'
    );
}

/**
 * Save settings to localStorage
 */
export function saveSettings() {
    storeSettings({
        query: queryTextarea.value,
        fillColor: state.fillColor,
        scaleToggle: scaleToggle.checked,
        overpassUrl: getCurrentOverpassUrl(),
        theme: getTheme(),
        groupByTag: groupByTagInput.value.trim(),
        respectOsmColors: state.respectOsmColors,
        sortBy: sortSelect.value,
        backend: getCurrentBackend(),
        // The Query tab owns its language; this only writes down what it says
        queryLang: getQueryLang()
    });
}

/**
 * Put loaded settings into the controls, the shared state and the theme
 * @param {Object} settings - The shape loadSettings() returns, possibly with
 *     shared-link values merged over it
 */
export function applySettings(settings) {
    queryTextarea.value = settings.query;
    fillColorInput.value = settings.fillColor;
    scaleToggle.checked = settings.scaleToggle;
    respectOsmColorsToggle.checked = settings.respectOsmColors;
    groupByTagInput.value = settings.groupByTag;
    sortSelect.value = settings.sortBy;
    state.fillColor = settings.fillColor;
    state.respectOsmColors = settings.respectOsmColors;
    state.maintainRelativeSize = settings.scaleToggle;
    state.overpassUrl = settings.overpassUrl;
    state.backend = normaliseBackend(settings.backend);

    // Set Overpass server select
    if (PREDEFINED_SERVERS.includes(settings.overpassUrl)) {
        overpassServerSelect.value = settings.overpassUrl;
    } else {
        overpassServerSelect.value = 'custom';
        overpassCustomUrlInput.value = settings.overpassUrl;
    }

    backendSelect.value = state.backend;
    applyBackendVisibility(state.backend);

    // Apply theme (use saved or fall back to system preference)
    applyTheme(settings.theme || getSystemTheme());
}

/**
 * Apply current sorting and rebuild the grid
 */
function applySorting() {
    if (state.geometries.length === 0) {
        return;
    }

    // Cleanup lazy loading state
    cleanupLazyLoading();

    // Sort the geometries in place
    state.geometries = sortGeometries(state.geometries, sortSelect.value);

    // Rebuild grid with lazy loading support (preserve isImported state)
    buildGrid({ isImported: state.lazyLoad.isImported || false });

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
 * Handle scale toggle change
 */
function handleScaleToggle() {
    state.maintainRelativeSize = scaleToggle.checked;
    if (state.geometries.length > 0) {
        renderAllGeometries();
    }
    saveSettings();
}

/**
 * Handle fill color change
 */
function handleFillColorChange() {
    state.fillColor = fillColorInput.value;
    if (state.geometries.length > 0) {
        renderAllGeometries();
    }
    saveSettings();
}

/**
 * Handle respect OSM colors toggle change
 */
function handleRespectOsmColorsToggle() {
    state.respectOsmColors = respectOsmColorsToggle.checked;
    if (state.geometries.length > 0) {
        renderAllGeometries();
    }
    saveSettings();
}

/**
 * Handle Overpass server selection change
 */
function handleOverpassServerChange() {
    applyBackendVisibility(getCurrentBackend());

    // Update current URL
    state.overpassUrl = getCurrentOverpassUrl();
    saveSettings();
}

/**
 * Handle a change of data source
 */
function handleBackendChange() {
    state.backend = getCurrentBackend();
    applyBackendVisibility(state.backend);

    // The Query tab's language and the Search tab's built query both follow
    // the source; whoever wired us knows how to make that happen
    if (onBackendChange) {
        onBackendChange(state.backend);
    }
    saveSettings();
}

/**
 * Handle custom Overpass URL change
 */
function handleOverpassCustomUrlChange() {
    state.overpassUrl = getCurrentOverpassUrl();
    saveSettings();
}

/**
 * Handle theme toggle button click
 */
function handleThemeToggle() {
    toggleTheme();
    saveSettings();
}

/**
 * Wire the settings controls
 * @param {Object} [options] - Wiring
 * @param {Function} [options.onBackendChange] - (backend) => void, the data
 *     source changed
 */
export function initSettingsHandlers(options = {}) {
    onBackendChange = options.onBackendChange || null;

    backendSelect.addEventListener('change', handleBackendChange);
    sortSelect.addEventListener('change', handleSortChange);
    scaleToggle.addEventListener('change', handleScaleToggle);
    fillColorInput.addEventListener('input', handleFillColorChange);
    respectOsmColorsToggle.addEventListener('change', handleRespectOsmColorsToggle);
    overpassServerSelect.addEventListener('change', handleOverpassServerChange);
    overpassCustomUrlInput.addEventListener('blur', handleOverpassCustomUrlChange);
    themeToggle.addEventListener('click', handleThemeToggle);
}
