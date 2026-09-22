/**
 * appState.js
 * The state shared between modules, and the settings that persist in
 * localStorage. Modules import `state` and read or write it directly.
 */

import { DEFAULT_OVERPASS_URL } from '../overpassClient.js';

/** The backends a query can be run against */
const BACKENDS = ['postpass', 'overpass'];

/** The one used until the user says otherwise */
const DEFAULT_BACKEND = 'postpass';

/**
 * Check a backend name that came from storage or a link
 * @param {string} backend - Candidate name
 * @returns {string} The name, or the default when it is not one we have
 */
export function normaliseBackend(backend) {
    return BACKENDS.includes(backend) ? backend : DEFAULT_BACKEND;
}

/**
 * The query language a backend speaks
 * @param {string} backend - 'postpass' or 'overpass'
 * @returns {'sql'|'ql'} The language of that backend
 */
export function backendLanguage(backend) {
    return normaliseBackend(backend) === 'postpass' ? 'sql' : 'ql';
}

/**
 * The backend that speaks a language, which is how the Query tab's own select
 * decides what its Execute button talks to
 * @param {string} lang - 'sql' or 'ql'
 * @returns {string} 'postpass' or 'overpass'
 */
export function languageBackend(lang) {
    return lang === 'sql' ? 'postpass' : 'overpass';
}

/**
 * The Overpass servers the settings dropdown offers. Anything else in the
 * saved settings is a server the user went and typed in themselves.
 */
export const PREDEFINED_SERVERS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

/**
 * Work out which language a saved query is written in, when nothing recorded
 * it. Only the giveaways count; a query that could be either is left to the
 * caller's fallback.
 * @param {string} query - The saved query text
 * @returns {'sql'|'ql'|null} The language, or null when the text does not say
 */
export function detectQueryLanguage(query) {
    // Leading blank lines and SQL line comments are not the statement
    const text = String(query ?? '').replace(/^(?:\s|--[^\n]*\n?)+/, '');

    if (!text) {
        return null;
    }
    // A statement can only start with SELECT or WITH in SQL, so that is decided
    // first: a string value inside it may well mention Overpass syntax
    if (/^(SELECT|WITH)\b/i.test(text)) {
        return 'sql';
    }
    // Overpass settings, or any of its output statements
    if (/\[out:/.test(text) || /(^|\n)\s*out\s/.test(text)) {
        return 'ql';
    }
    return null;
}

/**
 * The language a saved query is in, falling back to the backend's when the
 * text does not say
 * @param {string} query - The saved query text
 * @param {string} backend - The backend in force
 * @returns {'sql'|'ql'} The language to show it in
 */
export function inferQueryLanguage(query, backend) {
    return detectQueryLanguage(query) || backendLanguage(backend);
}

export const state = {
    // Parsed geometries currently shown, in grid order
    geometries: [],
    // Bounds of everything shown, in lon/lat
    globalBounds: null,
    // The largest projected extent of any geometry, for relative-size scaling
    maxDimension: null,
    fillColor: '#3388ff',
    overpassUrl: DEFAULT_OVERPASS_URL,
    // Which service answers queries: 'postpass' or 'overpass'. Postpass is the
    // default because it needs no server of one's own, which the public
    // Overpass instances effectively do.
    // The Query tab's language is not here: only ui/queryTab.js reads it, and
    // the select it owns is where it lives
    backend: DEFAULT_BACKEND,
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
    SORT_BY: 'xofy-osm-sort-by',
    BACKEND: 'xofy-osm-backend',
    QUERY_LANG: 'xofy-osm-query-lang'
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
        localStorage.setItem(STORAGE_KEYS.BACKEND, normaliseBackend(settings.backend));
        localStorage.setItem(STORAGE_KEYS.QUERY_LANG, settings.queryLang === 'sql' ? 'sql' : 'ql');
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
        sortBy: 'nodes-desc',
        backend: DEFAULT_BACKEND,
        queryLang: backendLanguage(DEFAULT_BACKEND)
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
        // Postpass unless a choice has been stored; a custom Overpass server
        // stays configured and is used as soon as Overpass is chosen
        const savedBackend = normaliseBackend(localStorage.getItem(STORAGE_KEYS.BACKEND));
        const savedQueryLang = localStorage.getItem(STORAGE_KEYS.QUERY_LANG);
        const query = savedQuery || defaults.query;

        return {
            query,
            fillColor: savedFillColor || defaults.fillColor,
            scaleToggle: savedScaleToggle === 'true',
            overpassUrl: savedOverpassUrl || defaults.overpassUrl,
            theme: savedTheme || defaults.theme,
            groupByTag: savedGroupByTag !== null ? savedGroupByTag : defaults.groupByTag,
            respectOsmColors: savedRespectOsmColors === null ? defaults.respectOsmColors : savedRespectOsmColors === 'true',
            sortBy: savedSortBy || defaults.sortBy,
            backend: savedBackend,
            // Nothing saved means this page has never had a language of its
            // own. A query left in the textarea says which language it is in
            // far more reliably than the backend setting does, so a saved
            // Overpass query does not come back looking like broken SQL
            queryLang: savedQueryLang === 'sql' || savedQueryLang === 'ql'
                ? savedQueryLang
                : inferQueryLanguage(query, savedBackend)
        };
    } catch (e) {
        console.warn('Failed to load settings from localStorage:', e);
        return defaults;
    }
}
