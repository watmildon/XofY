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

// DOM elements
const queryTextarea = document.getElementById('overpass-query');
const submitBtn = document.getElementById('submit-btn');
const curatedSubmitBtn = document.getElementById('curated-submit-btn');
const featureSelect = document.getElementById('feature-select');
const areaSelect = document.getElementById('area-select');
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

// Features (X) - what we're looking for
const FEATURES = {
    'churches': {
        displayName: 'Churches',
        tags: '["building"="church"]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'parks': {
        displayName: 'Named Parks',
        tags: '["leisure"="park"][name]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'museums': {
        displayName: 'Museums',
        tags: '["tourism"="museum"]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'swimming_pools': {
        displayName: 'Swimming Pools',
        tags: '["leisure"="swimming_pool"]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'primary_highways': {
        displayName: 'Primary Roadways with Names',
        tags: '["highway"="primary"][name]',
        elementTypes: 'way',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: 'name'
    },
    'water_slides': {
        displayName: 'Water Slides',
        tags: '["attraction"="water_slide"]',
        elementTypes: 'way',
        minAdminLevel: 4,
        allowedAreas: null,
        groupBy: null
    },
    'motor_raceways': {
        displayName: 'Motor Raceways',
        tags: '["highway"="raceway"]["sport"="motor"]',
        elementTypes: 'way',
        minAdminLevel: 2,
        allowedAreas: null,
        groupBy: null
    },
    'cooling_basins': {
        displayName: 'Cooling Basins',
        tags: '["basin"="cooling"]',
        elementTypes: 'wr',
        minAdminLevel: 0,
        allowedAreas: null,
        groupBy: null
    },
    'jetsprint_lakes': {
        displayName: 'Jetsprint Lakes',
        tags: '["sport"="jetsprint"]["natural"="water"]',
        elementTypes: 'wr',
        minAdminLevel: 0,
        allowedAreas: ['world'], 
        groupBy: null
    },
    'shot_put_pitches': {
        displayName: 'Shot Put Pitches',
        tags: '[athletics=shot_put]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: null,
        groupBy: null
    },
    'race_tracks': {
        displayName: 'Non-motor Race Tracks',
        tags: '[leisure=track][!athletics]',
        elementTypes: 'wr',
        minAdminLevel: 8,
        allowedAreas: null,
        groupBy: null
    },
    'subway_routes': {
        displayName: 'Subway Routes',
        tags: '[route=subway]',
        elementTypes: 'rel',
        minAdminLevel: 8,
        allowedAreas: ['nyc', 'paris', 'tokyo', 'seoul', 'singapore'],
        groupBy: null
    },
    'historic_aircraft': {
        displayName: 'Historic Aircraft',
        tags: '["historic"="aircraft"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['usa', 'germany', 'uk', 'france', 'italy', 'poland', 'australia', 'japan', 'brazil', 'south_africa', 'new_zealand', 'arizona', 'california', 'washington_state'],
        groupBy: null
    },
    'roller_coasters': {
        displayName: 'Roller Coasters',
        tags: '["roller_coaster"="track"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['disney_world'],
        groupBy: null
    },
    'cathedrals': {
        displayName: 'Cathedrals',
        tags: '["building"="cathedral"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['usa', 'germany', 'uk', 'france', 'italy', 'poland', 'australia', 'japan', 'brazil', 'south_africa', 'new_zealand'],
        groupBy: null
    },
    'geoglyphs': {
        displayName: 'Geoglyphs',
        tags: '["man_made"="geoglyph"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['usa', 'germany', 'uk', 'france', 'italy', 'poland', 'australia', 'japan', 'brazil', 'south_africa', 'new_zealand'],
        groupBy: null
    },
    'lazy_rivers': {
        displayName: 'Lazy Rivers',
        tags: '["leisure"="swimming_pool"]["swimming_pool"="lazy_river"]',
        elementTypes: 'wr',
        minAdminLevel: 4,
        allowedAreas: ['arizona', 'california', 'washington_state', 'disney_world'],
        groupBy: null
    },
    'large_flowerbeds': {
        displayName: 'Large Flowerbeds (>50 nodes)',
        tags: '["landuse"="flowerbed"]',
        elementTypes: 'way',
        minAdminLevel: 2,
        allowedAreas: null,
        groupBy: null,
        customQuery: true
    },
    'playground_maps': {
        displayName: 'Playground Maps',
        tags: '["playground"="map"]',
        elementTypes: 'wr',
        minAdminLevel: 2,
        allowedAreas: ['usa', 'arizona', 'california', 'washington_state'],
        groupBy: null
    }
};

// Areas (Y) - where we're looking
const AREAS = {
    // World (special case - no area filter)
    'world': { displayName: 'The World', relationId: null, adminLevel: 0 },

    // Countries (admin_level 2)
    'usa': { displayName: 'United States', relationId: 148838, adminLevel: 2 },
    'germany': { displayName: 'Germany', relationId: 51477, adminLevel: 2 },
    'uk': { displayName: 'United Kingdom', relationId: 62149, adminLevel: 2 },
    'france': { displayName: 'France', relationId: 2202162, adminLevel: 2 },
    'italy': { displayName: 'Italy', relationId: 365331, adminLevel: 2 },
    'poland': { displayName: 'Poland', relationId: 49715, adminLevel: 2 },
    'australia': { displayName: 'Australia', relationId: 80500, adminLevel: 2 },
    'japan': { displayName: 'Japan', relationId: 382313, adminLevel: 2 },
    'brazil': { displayName: 'Brazil', relationId: 59470, adminLevel: 2 },
    'south_africa': { displayName: 'South Africa', relationId: 87565, adminLevel: 2 },
    'new_zealand': { displayName: 'New Zealand', relationId: 556706, adminLevel: 2 },

    // States/Provinces (admin_level 4)
    'arizona': { displayName: 'Arizona, US', relationId: 162018, adminLevel: 4 },
    'california': { displayName: 'California, US', relationId: 165475, adminLevel: 4 },
    'washington_state': { displayName: 'Washington, US', relationId: 165479, adminLevel: 4 },

    // Cities (admin_level 8)
    'seattle': { displayName: 'Seattle, WA', relationId: 237385, adminLevel: 8 },
    'phoenix': { displayName: 'Phoenix, AZ', relationId: 111257, adminLevel: 8 },
    'paris': { displayName: 'Paris, France', relationId: 7444, adminLevel: 8 },
    'sydney': { displayName: 'Sydney, AU', relationId: 5750005, adminLevel: 8 },
    'nyc': { displayName: 'New York City, NY', relationId: 175905, adminLevel: 8 },
    'tokyo': { displayName: 'Tokyo, Japan', relationId: 1543125, adminLevel: 8 },
    'seoul': { displayName: 'Seoul, South Korea', relationId: 2297418, adminLevel: 8 },
    'singapore': { displayName: 'Singapore', relationId: 536780, adminLevel: 8 },
    'bangkok': { displayName: 'Bangkok, Thailand', relationId: 92277, adminLevel: 8 },
    'cape_town': { displayName: 'Cape Town, South Africa', relationId: 79604, adminLevel: 8 },
    'nairobi': { displayName: 'Nairobi, Kenya', relationId: 3492709, adminLevel: 8 },
    'lagos': { displayName: 'Lagos, Nigeria', relationId: 3718182, adminLevel: 8 },
    'sao_paulo': { displayName: 'São Paulo, Brazil', relationId: 298285, adminLevel: 8 },
    'buenos_aires': { displayName: 'Buenos Aires, Argentina', relationId: 3082668, adminLevel: 8 },

    // Special areas (theme parks, etc.)
    'disney_world': { displayName: 'Disney World, FL', relationId: 1228099, adminLevel: 10 }
};

/**
 * Build an Overpass query from a feature and area selection
 * @param {string} featureKey - Key from FEATURES object
 * @param {string} areaKey - Key from AREAS object
 * @returns {string} Overpass QL query
 */
function buildQuery(featureKey, areaKey) {
    const feature = FEATURES[featureKey];
    const area = AREAS[areaKey];

    if (!feature || !area) {
        return '';
    }

    // Handle special custom queries (like flowerbeds with foreach)
    if (feature.customQuery && featureKey === 'large_flowerbeds') {
        if (!area.relationId) {
            // World query for flowerbeds
            return `[out:json];
way${feature.tags};
foreach (
  way._(if:count_members() > 50);
  out geom;
);`;
        }
        return `[out:json];
rel(${area.relationId});
map_to_area->.searchArea;
way(area.searchArea)${feature.tags};
foreach (
  way._(if:count_members() > 50);
  out geom;
);`;
    }

    // Handle subway routes with network filter
    if (featureKey === 'subway_routes') {
        if (areaKey === 'nyc') {
            return `[out:json];
rel[route=subway][network="NYC Subway"];
out geom;`;
        }
        if (areaKey === 'paris') {
            return `[out:json];
rel[route=subway][network="Métro de Paris"];
out geom;`;
        }
        if (areaKey === 'tokyo') {
            return `[out:json];
(
  rel[route=subway][network="Tokyo Metro"];
  rel[route=subway][network="都営地下鉄"];
);
out geom;`;
        }
        if (areaKey === 'seoul') {
            return `[out:json];
rel[route=subway][network="수도권 전철"];
out geom;`;
        }
        if (areaKey === 'singapore') {
            return `[out:json];
rel[route=subway][operator="SMRT Trains"];
out geom;`;
        }
    }

    // World query - no area filter
    if (!area.relationId) {
        return `[out:json];
${feature.elementTypes}${feature.tags};
out geom;`;
    }

    // Standard area-based query
    return `[out:json];
rel(${area.relationId});
map_to_area->.searchArea;
${feature.elementTypes}(area.searchArea)${feature.tags};
out geom;`;
}

/**
 * Get valid areas for a given feature based on minAdminLevel and allowedAreas
 * @param {string} featureKey - Key from FEATURES object
 * @returns {Array} Array of [key, area] entries that are valid for this feature
 */
function getValidAreasForFeature(featureKey) {
    const feature = FEATURES[featureKey];
    if (!feature) return [];

    // If feature has explicit allowedAreas, use only those
    if (feature.allowedAreas) {
        return feature.allowedAreas
            .filter(key => AREAS[key])
            .map(key => [key, AREAS[key]]);
    }

    // Otherwise filter by minAdminLevel
    return Object.entries(AREAS)
        .filter(([_, area]) => area.adminLevel >= feature.minAdminLevel);
}

/**
 * Populate the feature dropdown with all available features
 */
function populateFeatureDropdown() {
    const featureSelect = document.getElementById('feature-select');
    featureSelect.innerHTML = '<option value="">Select a feature...</option>';

    Object.entries(FEATURES)
        .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName))
        .forEach(([key, feature]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = feature.displayName;
            featureSelect.appendChild(option);
        });
}

/**
 * Update the area dropdown based on the selected feature
 * Groups areas by admin level hierarchy
 * @param {string} featureKey - Key from FEATURES object
 */
function updateAreaDropdown(featureKey) {
    const areaSelect = document.getElementById('area-select');

    if (!featureKey) {
        areaSelect.innerHTML = '<option value="">Select a feature first...</option>';
        areaSelect.disabled = true;
        return;
    }

    const validAreas = getValidAreasForFeature(featureKey);

    if (validAreas.length === 0) {
        areaSelect.innerHTML = '<option value="">No areas available</option>';
        areaSelect.disabled = true;
        return;
    }

    // Group by admin level
    const groups = {
        0: { label: 'World', areas: [] },
        2: { label: 'Countries', areas: [] },
        4: { label: 'States / Provinces', areas: [] },
        6: { label: 'Counties', areas: [] },
        8: { label: 'Cities', areas: [] },
        10: { label: 'Special Areas', areas: [] }
    };

    validAreas.forEach(([key, area]) => {
        // Normalize admin level to group bucket
        let level;
        if (area.adminLevel === 0) level = 0;
        else if (area.adminLevel <= 2) level = 2;
        else if (area.adminLevel <= 4) level = 4;
        else if (area.adminLevel <= 6) level = 6;
        else if (area.adminLevel <= 8) level = 8;
        else level = 10;

        groups[level].areas.push({ key, ...area });
    });

    // Build dropdown with optgroups
    areaSelect.innerHTML = '<option value="">Select an area...</option>';

    // Sort groups from largest to smallest, with special areas at bottom
    const sortedLevels = [0, 2, 4, 6, 8, 10];

    sortedLevels.forEach(level => {
        const group = groups[level];
        if (group.areas.length > 0) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;

            // Sort areas within group alphabetically
            group.areas
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .forEach(area => {
                    const option = document.createElement('option');
                    option.value = area.key;
                    option.textContent = area.displayName;
                    optgroup.appendChild(option);
                });

            areaSelect.appendChild(optgroup);
        }
    });

    areaSelect.disabled = false;
}

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

// Tab state
let currentTab = 'curated';

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
    // Set on both root (for icon CSS) and body (for theme colors CSS)
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    // Icon visibility is handled by CSS based on data-theme attribute
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
 * Encode current state to URL parameters
 * @returns {string} URL with encoded parameters
 */
function encodeStateToURL() {
    const params = new URLSearchParams();

    // Check if we're on curated tab with feature/area selected
    const selectedFeature = featureSelect.value;
    const selectedArea = areaSelect.value;

    if (currentTab === 'curated' && selectedFeature && selectedArea) {
        // Use feature/area params for curated queries
        params.set('feature', selectedFeature);
        params.set('area', selectedArea);
    } else if (queryTextarea.value.trim()) {
        // Fall back to raw query for overpass tab
        params.set('q', btoa(encodeURIComponent(queryTextarea.value)));
    }

    if (fillColorInput.value !== '#3388ff') {
        params.set('color', fillColorInput.value.substring(1)); // Remove #
    }

    if (scaleToggle.checked) {
        params.set('scale', '1');
    }

    if (groupByTagInput.value.trim()) {
        params.set('gtag', groupByTagInput.value.trim());
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

    // Decode feature/area params (new format)
    if (params.has('feature') && params.has('area')) {
        state.feature = params.get('feature');
        state.area = params.get('area');
    }

    // Decode query (legacy format)
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

    // Decode group by tag
    if (params.has('gtag')) {
        state.groupByTag = params.get('gtag');
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
 * Handle feature selection - updates area dropdown and syncs query
 */
function handleFeatureSelect() {
    const selectedFeature = featureSelect.value;

    // Update area dropdown based on selected feature
    updateAreaDropdown(selectedFeature);

    // Reset area selection when feature changes
    areaSelect.value = '';

    // Disable submit button until both are selected
    curatedSubmitBtn.disabled = true;

    // Clear the query preview in Overpass tab
    if (!selectedFeature) {
        return;
    }

    saveSettings();
}

/**
 * Handle area selection - builds and syncs query to Overpass tab
 */
function handleAreaSelect() {
    const selectedFeature = featureSelect.value;
    const selectedArea = areaSelect.value;

    // Enable submit only if both are selected
    curatedSubmitBtn.disabled = !(selectedFeature && selectedArea);

    if (selectedFeature && selectedArea) {
        const feature = FEATURES[selectedFeature];

        // Build the query
        const query = buildQuery(selectedFeature, selectedArea);
        queryTextarea.value = query;

        // Apply group by settings from feature
        groupByTagInput.value = feature.groupBy || '';

        // Update Overpass submit button state since query changed
        updateOverpassSubmitState();
        saveSettings();
    }
}

/**
 * Handle curated tab Execute button - runs the built query
 */
function handleCuratedSubmit() {
    const selectedFeature = featureSelect.value;
    const selectedArea = areaSelect.value;

    if (!selectedFeature || !selectedArea) {
        showError('Please select both a feature and an area');
        return;
    }

    // The query is already synced to the Overpass tab via handleAreaSelect
    // Just execute it
    handleSubmit();
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

    // Determine initial tab based on URL parameters
    if (urlParams && urlParams.feature && urlParams.area) {
        // If URL has feature/area params, set up curated tab and stay there
        switchTab('curated');
        // Dropdowns will be populated after event listeners are set up
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

    // Curated tab event listeners
    featureSelect.addEventListener('change', handleFeatureSelect);
    areaSelect.addEventListener('change', handleAreaSelect);

    // Populate feature dropdown on init
    populateFeatureDropdown();

    // Apply feature/area from URL params if present
    if (urlParams && urlParams.feature && urlParams.area) {
        if (FEATURES[urlParams.feature] && AREAS[urlParams.area]) {
            featureSelect.value = urlParams.feature;
            updateAreaDropdown(urlParams.feature);
            areaSelect.value = urlParams.area;
            // Trigger the area select handler to build the query
            handleAreaSelect();
        }
    }

    // Event listeners
    submitBtn.addEventListener('click', handleSubmit);
    curatedSubmitBtn.addEventListener('click', handleCuratedSubmit);
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
