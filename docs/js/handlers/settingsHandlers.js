/**
 * settingsHandlers.js
 * The display and server settings: applying them on load, reacting when they
 * change, and saving them to localStorage
 */

import { DEFAULT_OVERPASS_URL, normaliseOverpassUrl } from '../overpassClient.js';
import {
    state,
    storeSettings,
    normaliseBackend,
    PREDEFINED_SERVERS,
    DEFAULT_SUB_FEATURE_COLOR,
    normaliseDotSize
} from '../state/appState.js';
import { renderAllGeometries, buildGrid } from '../utils/rendering.js';
import { cleanupLazyLoading } from '../utils/lazyLoading.js';
import { sortGeometries } from '../utils/sorting.js';
import { applyTheme, getSystemTheme, getTheme, toggleTheme } from '../ui/theme.js';
import { getQueryLang } from '../ui/queryTab.js';
import { closeSettings } from '../ui/modals.js';

const queryTextarea = document.getElementById('overpass-query');
const sortSelect = document.getElementById('sort-select');
const scaleToggle = document.getElementById('scale-toggle');
const fillColorInput = document.getElementById('fill-color');
const respectOsmColorsToggle = document.getElementById('respect-osm-colors');
const overpassServerSelect = document.getElementById('overpass-server-select');
const overpassCustomUrlInput = document.getElementById('overpass-custom-url');
const customUrlGroup = document.getElementById('custom-url-group');
const overpassServerGroup = document.getElementById('overpass-server-group');
const saveSettingsBtn = document.getElementById('save-settings');
const backendSelect = document.getElementById('backend-select');
const themeToggle = document.getElementById('theme-toggle');
const groupByTagInput = document.getElementById('group-by-tag');
const curatedGroupByTagInput = document.getElementById('curated-group-by-tag');
const subFeatureTagInput = document.getElementById('sub-feature-tag');
const curatedSubFeatureTagInput = document.getElementById('curated-sub-feature-tag');
const subFeatureColorInput = document.getElementById('sub-feature-color');
const subFeatureColorControl = document.getElementById('sub-feature-color-control');
const subFeatureDotSizeInput = document.getElementById('sub-feature-dot-size');
const subFeatureDotControl = document.getElementById('sub-feature-dot-control');

// Called with the new backend when the data source changes
let onBackendChange = null;

/**
 * Get the current Overpass URL from the UI
 * @returns {string} The current Overpass URL
 */
export function getCurrentOverpassUrl() {
    const selectedValue = overpassServerSelect.value;
    if (selectedValue === 'custom') {
        return normaliseOverpassUrl(overpassCustomUrlInput.value) || DEFAULT_OVERPASS_URL;
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
 * Show the sub-feature colour picker and dot size slider only while there is
 * a sub-feature to draw with them. Called by whoever changes the Sub-feature
 * field.
 */
export function syncSubFeatureColorVisibility() {
    const none = subFeatureTagInput.value.trim() === '';
    subFeatureColorControl.classList.toggle('hidden', none);
    subFeatureDotControl.classList.toggle('hidden', none);
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
        queryLang: getQueryLang(),
        subFeatureTag: subFeatureTagInput.value.trim(),
        subFeatureColor: state.subFeatureColor,
        subFeatureDotSize: state.subFeatureDotSize
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
    curatedGroupByTagInput.value = settings.groupByTag;
    subFeatureTagInput.value = settings.subFeatureTag || '';
    curatedSubFeatureTagInput.value = settings.subFeatureTag || '';
    subFeatureColorInput.value = settings.subFeatureColor || DEFAULT_SUB_FEATURE_COLOR;
    syncSubFeatureColorVisibility();
    sortSelect.value = settings.sortBy;
    state.fillColor = settings.fillColor;
    state.subFeatureColor = settings.subFeatureColor || DEFAULT_SUB_FEATURE_COLOR;
    state.subFeatureDotSize = normaliseDotSize(settings.subFeatureDotSize);
    subFeatureDotSizeInput.value = String(state.subFeatureDotSize);
    state.respectOsmColors = settings.respectOsmColors;
    state.maintainRelativeSize = settings.scaleToggle;
    // A custom URL saved before /interpreter was added for the user
    state.overpassUrl = normaliseOverpassUrl(settings.overpassUrl) || DEFAULT_OVERPASS_URL;
    state.backend = normaliseBackend(settings.backend);

    // Set Overpass server select
    if (PREDEFINED_SERVERS.includes(state.overpassUrl)) {
        overpassServerSelect.value = state.overpassUrl;
    } else {
        overpassServerSelect.value = 'custom';
        overpassCustomUrlInput.value = state.overpassUrl;
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
 * Handle sub-feature color change
 */
function handleSubFeatureColorChange() {
    state.subFeatureColor = subFeatureColorInput.value;
    if (state.geometries.length > 0) {
        renderAllGeometries();
    }
    saveSettings();
}

/**
 * Handle dot size slider change
 */
function handleSubFeatureDotSizeChange() {
    state.subFeatureDotSize = normaliseDotSize(subFeatureDotSizeInput.value);
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
    // Show the URL that will actually be used, /interpreter and all
    if (overpassCustomUrlInput.value.trim() !== '') {
        overpassCustomUrlInput.value = state.overpassUrl;
    }
    saveSettings();
}

/**
 * Handle the Save button. Every other control saves as it changes and the
 * URL box saves on blur, so this commits the URL and closes the pane, which
 * is what someone typing a URL expects a save to do.
 */
function handleSaveSettings() {
    handleOverpassCustomUrlChange();
    closeSettings();
}

/**
 * Enter in the URL box saves, as the button does
 * @param {KeyboardEvent} e - The keydown event
 */
function handleOverpassCustomUrlKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveSettings();
    }
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
    subFeatureColorInput.addEventListener('input', handleSubFeatureColorChange);
    subFeatureDotSizeInput.addEventListener('input', handleSubFeatureDotSizeChange);
    respectOsmColorsToggle.addEventListener('change', handleRespectOsmColorsToggle);
    overpassServerSelect.addEventListener('change', handleOverpassServerChange);
    overpassCustomUrlInput.addEventListener('blur', handleOverpassCustomUrlChange);
    overpassCustomUrlInput.addEventListener('keydown', handleOverpassCustomUrlKeydown);
    saveSettingsBtn.addEventListener('click', handleSaveSettings);
    themeToggle.addEventListener('click', handleThemeToggle);
}
