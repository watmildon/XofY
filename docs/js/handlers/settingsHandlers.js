/**
 * settingsHandlers.js
 * The display and server settings: applying them on load, reacting when they
 * change, and saving them to localStorage
 */

import { DEFAULT_OVERPASS_URL } from '../overpassClient.js';
import { state, storeSettings } from '../state/appState.js';
import { renderAllGeometries, buildGrid } from '../utils/rendering.js';
import { cleanupLazyLoading } from '../utils/lazyLoading.js';
import { sortGeometries } from '../utils/sorting.js';
import { applyTheme, getSystemTheme, getTheme, toggleTheme } from '../ui/theme.js';

const queryTextarea = document.getElementById('overpass-query');
const sortSelect = document.getElementById('sort-select');
const scaleToggle = document.getElementById('scale-toggle');
const fillColorInput = document.getElementById('fill-color');
const respectOsmColorsToggle = document.getElementById('respect-osm-colors');
const overpassServerSelect = document.getElementById('overpass-server-select');
const overpassCustomUrlInput = document.getElementById('overpass-custom-url');
const customUrlGroup = document.getElementById('custom-url-group');
const themeToggle = document.getElementById('theme-toggle');
const groupByTagInput = document.getElementById('group-by-tag');

// The servers offered in the settings dropdown; anything else is "custom"
const PREDEFINED_SERVERS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

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
        sortBy: sortSelect.value
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

    // Set Overpass server select
    if (PREDEFINED_SERVERS.includes(settings.overpassUrl)) {
        overpassServerSelect.value = settings.overpassUrl;
        customUrlGroup.classList.add('hidden');
    } else {
        overpassServerSelect.value = 'custom';
        overpassCustomUrlInput.value = settings.overpassUrl;
        customUrlGroup.classList.remove('hidden');
    }

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
    const selectedValue = overpassServerSelect.value;

    // Show/hide custom URL input
    if (selectedValue === 'custom') {
        customUrlGroup.classList.remove('hidden');
    } else {
        customUrlGroup.classList.add('hidden');
    }

    // Update current URL
    state.overpassUrl = getCurrentOverpassUrl();
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
 */
export function initSettingsHandlers() {
    sortSelect.addEventListener('change', handleSortChange);
    scaleToggle.addEventListener('change', handleScaleToggle);
    fillColorInput.addEventListener('input', handleFillColorChange);
    respectOsmColorsToggle.addEventListener('change', handleRespectOsmColorsToggle);
    overpassServerSelect.addEventListener('change', handleOverpassServerChange);
    overpassCustomUrlInput.addEventListener('blur', handleOverpassCustomUrlChange);
    themeToggle.addEventListener('click', handleThemeToggle);
}
