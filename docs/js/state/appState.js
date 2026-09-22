/**
 * appState.js
 * The state shared between modules, and the settings that persist in
 * localStorage. Modules import `state` and read or write it directly.
 */

import { DEFAULT_OVERPASS_URL } from '../overpassClient.js';

export const state = {
    // Parsed geometries currently shown, in grid order
    geometries: [],
    // Bounds of everything shown, in lon/lat
    globalBounds: null,
    // The largest projected extent of any geometry, for relative-size scaling
    maxDimension: null,
    fillColor: '#3388ff',
    overpassUrl: DEFAULT_OVERPASS_URL,
    respectOsmColors: true,
    maintainRelativeSize: false,

    // Lazy loading of the grid
    lazyLoad: {
        enabled: false,
        renderedCount: 0,
        totalCount: 0,
        isLoading: false,
        batchSize: 50,
        loadThreshold: 300, // pixels from bottom
        isImported: false   // whether current data is from GeoJSON import
    }
};

// LocalStorage keys
export const STORAGE_KEYS = {
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
 * The options every canvas is drawn with
 * @returns {Object} Options for canvasRenderer's renderGeometry()
 */
export function getRenderOptions() {
    return {
        maintainRelativeSize: state.maintainRelativeSize,
        maxDimension: state.maxDimension,
        fillColor: state.fillColor,
        respectOsmColors: state.respectOsmColors
    };
}

/**
 * Save settings to localStorage
 * @param {Object} settings - The same shape loadSettings() returns
 */
export function storeSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEYS.QUERY, settings.query);
        localStorage.setItem(STORAGE_KEYS.FILL_COLOR, settings.fillColor);
        localStorage.setItem(STORAGE_KEYS.SCALE_TOGGLE, String(settings.scaleToggle));
        localStorage.setItem(STORAGE_KEYS.OVERPASS_URL, settings.overpassUrl);
        localStorage.setItem(STORAGE_KEYS.THEME, settings.theme);
        localStorage.setItem(STORAGE_KEYS.GROUP_BY_TAG, settings.groupByTag);
        localStorage.setItem(STORAGE_KEYS.RESPECT_OSM_COLORS, String(settings.respectOsmColors));
        localStorage.setItem(STORAGE_KEYS.SORT_BY, settings.sortBy);
    } catch (e) {
        console.warn('Failed to save settings to localStorage:', e);
    }
}

/**
 * Load settings from localStorage
 * @returns {Object} Saved settings or defaults
 */
export function loadSettings() {
    const defaults = {
        query: '',
        fillColor: '#3388ff',
        scaleToggle: false,
        overpassUrl: DEFAULT_OVERPASS_URL,
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
