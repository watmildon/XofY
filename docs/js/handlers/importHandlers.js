/**
 * importHandlers.js
 * The Import tab: choosing a GeoJSON file, then drawing it
 */

import { parseElements } from '../geometryParser.js';
import { state } from '../state/appState.js';
import { convertGeoJsonToElements } from '../utils/geojsonConverter.js';
import { sortGeometries } from '../utils/sorting.js';
import { adoptGeometries, buildGrid } from '../utils/rendering.js';
import { showLoading, hideLoading, showError, showWarnings, showStats } from '../utils/uiHelpers.js';
import { getSortBy } from './settingsHandlers.js';

const geojsonImport = document.getElementById('geojson-import');
const importFileLabel = document.getElementById('import-file-label');
const importBtn = document.getElementById('import-btn');
const importGroupByTagInput = document.getElementById('import-group-by-tag');

// Pending import file (for two-step import flow)
let pendingImportFile = null;

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
        adoptGeometries(sortGeometries(geometries, getSortBy()));

        // Show statistics
        showStats(
            state.geometries.length,
            state.geometries,
            warnings.length
        );

        // Create grid with lazy loading support (hide OSM/JOSM links for imported data)
        buildGrid({ isImported: true });

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
 * Wire the Import tab's controls
 */
export function initImportHandlers() {
    geojsonImport.addEventListener('change', handleGeojsonFileSelect);
    importBtn.addEventListener('click', handleImportSubmit);
}
