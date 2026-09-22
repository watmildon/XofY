/**
 * main.js
 * Main application entry point
 * Loads the saved settings and any shared link, then wires up every module
 */

import { loadSettings } from './state/appState.js';
import { setupLazyLoading } from './utils/lazyLoading.js';
import { initTabs, switchTab } from './ui/tabs.js';
import { initDisplayPanel } from './ui/displayPanel.js';
import { initModals } from './ui/modals.js';
import { applySettings, initSettingsHandlers } from './handlers/settingsHandlers.js';
import { initQueryHandlers, updateOverpassSubmitState, dismissCountWarning } from './handlers/queryHandlers.js';
import { initImportHandlers } from './handlers/importHandlers.js';
import { initShareHandlers, decodeURLParams } from './handlers/shareHandlers.js';

/**
 * Initialize the application
 */
function init() {
    // Check for URL parameters first (they override saved settings)
    const urlParams = decodeURLParams();

    // Load saved settings
    const settings = loadSettings();

    // Merge URL parameters with saved settings (URL params take precedence).
    // A link only carries the query and display options, so the sort order,
    // server and theme always come from the saved settings.
    const finalSettings = {
        ...settings,
        ...urlParams
    };

    applySettings(finalSettings);

    // Set initial state of Overpass submit button
    updateOverpassSubmitState();

    // A URL selection needs both halves: a curated or free-form feature, and a
    // curated or searched area
    const urlSelection = urlParams && (urlParams.feature || urlParams.x) && (urlParams.area || urlParams.y)
        ? urlParams
        : null;

    // A size warning belongs to the Search tab's current selection
    initTabs({ onSwitch: dismissCountWarning });

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

    initImportHandlers();
    initQueryHandlers({ urlSelection });
    initSettingsHandlers();
    initShareHandlers();
    initDisplayPanel();
    initModals();
    setupLazyLoading();

    console.log('XofY OSM Geometry Viewer initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
