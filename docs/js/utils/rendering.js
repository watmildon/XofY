/**
 * rendering.js
 * Puts the current geometries on the grid: adopting a parsed result set,
 * building the grid, and drawing the canvases that are in the DOM
 */

import { state, getRenderOptions } from '../state/appState.js';
import { getGlobalBounds } from '../boundingBox.js';
import { createGrid, getCanvases } from '../gridLayout.js';
import { renderGeometry } from '../canvasRenderer.js';
import { reprojectBounds } from '../reproject.js';
import { setupPreviewListeners } from '../ui/modals.js';

const gridContainer = document.getElementById('geometry-grid');

/**
 * Make a parsed, sorted result set the current one, working out its bounds
 * and the largest dimension (for relative size scaling)
 * @param {Array} geometries - Geometry objects in grid order
 */
export function adoptGeometries(geometries) {
    state.geometries = geometries;
    state.globalBounds = getGlobalBounds(geometries);

    // Use reprojected bounds to match the renderer's coordinate space
    state.maxDimension = Math.max(
        ...geometries.map(geom => {
            const projBounds = reprojectBounds(geom.bounds);
            return Math.max(projBounds.width, projBounds.height);
        })
    );
}

/**
 * Render all geometries on their canvases (only renders loaded items)
 */
export function renderAllGeometries() {
    if (state.geometries.length === 0) {
        return;
    }

    const canvases = getCanvases(gridContainer);
    const renderOptions = {
        ...getRenderOptions(),
        maxDimension: state.maintainRelativeSize ? state.maxDimension : null
    };

    // Only render canvases that are currently in the DOM
    canvases.forEach(canvas => {
        const index = parseInt(canvas.dataset.index);
        const geom = state.geometries[index];
        if (geom) {
            renderGeometry(canvas, geom, renderOptions);
        }
    });
}

/**
 * Render geometries for a specific batch
 * @param {number} startIndex - First index to draw
 * @param {number} endIndex - One past the last index to draw
 */
export function renderGeometriesForBatch(startIndex, endIndex) {
    const renderOptions = getRenderOptions();

    const canvases = getCanvases(gridContainer);
    canvases.forEach(canvas => {
        const index = parseInt(canvas.dataset.index);
        if (index >= startIndex && index < endIndex) {
            const geom = state.geometries[index];
            if (geom) {
                renderGeometry(canvas, geom, renderOptions);
            }
        }
    });
}

/**
 * Build the grid for the current geometries, draw the first batch and wire
 * the hover previews. Lazy loading picks up the rest on scroll.
 * @param {Object} options
 * @param {boolean} options.isImported - Whether the data came from a GeoJSON
 *     import (which hides OSM/JOSM links)
 */
export function buildGrid({ isImported }) {
    const gridResult = createGrid(gridContainer, state.geometries, {
        initialBatch: 50,
        lazyLoadThreshold: 100,
        isImported
    });

    // Update lazy loading state
    state.lazyLoad.enabled = gridResult.isLazyLoaded;
    state.lazyLoad.renderedCount = gridResult.renderedCount;
    state.lazyLoad.totalCount = gridResult.totalCount;
    state.lazyLoad.isImported = gridResult.isImported;

    renderAllGeometries();
    setupPreviewListeners();
}
