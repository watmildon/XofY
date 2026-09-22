/**
 * modals.js
 * The settings modal, the detail modal for one geometry, and the hover
 * preview tooltip over grid items
 */

import { state, getRenderOptions } from '../state/appState.js';
import { renderGeometry } from '../canvasRenderer.js';
import { sortTagKeys } from '../gridLayout.js';
import { synthesisedTagKeys } from '../search/postpassResults.js';

// Settings modal elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');

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

const gridContainer = document.getElementById('geometry-grid');

// Detail modal state
const detailModalState = {
    currentIndex: 0,
    isOpen: false
};

// Preview tooltip state
const previewState = {
    hoverTimeout: null,
    currentIndex: -1
};

// ==========================================
// Settings Modal
// ==========================================

/**
 * Open settings modal
 */
export function openSettings() {
    settingsModal.classList.remove('hidden');
}

/**
 * Close settings modal
 */
export function closeSettings() {
    settingsModal.classList.add('hidden');
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
    if (index < 0 || index >= state.geometries.length) return;
    if (detailModalState.isOpen) return; // Don't show preview if modal is open

    const geom = state.geometries[index];
    previewState.currentIndex = index;

    // Setup canvas with HiDPI scaling
    const displaySize = 400;
    const dpr = window.devicePixelRatio || 1;
    previewCanvas.width = displaySize * dpr;
    previewCanvas.height = displaySize * dpr;
    previewCanvas.style.width = displaySize + 'px';
    previewCanvas.style.height = displaySize + 'px';

    // Render geometry
    renderGeometry(previewCanvas, geom, getRenderOptions());

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

/**
 * Setup hover preview listeners on geometry items
 * Called after grid is created/updated
 */
export function setupPreviewListeners() {
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
    if (index < 0 || index >= state.geometries.length) return;

    const geom = state.geometries[index];
    detailModalState.currentIndex = index;

    // Update counter
    detailCounter.textContent = `${index + 1} of ${state.geometries.length}`;

    // Update nav button states
    detailPrevBtn.disabled = index === 0;
    detailNextBtn.disabled = index === state.geometries.length - 1;

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
    renderGeometry(detailCanvas, geom, getRenderOptions());

    // Build links section
    let linksHtml = '';
    // A geometry can only be linked to when it really is one OSM object.
    // Imported files invent their ids, and so does the Postpass converter for
    // the pieces of a way whose geometry arrived split (`123_0`), which is why
    // those ids are not integers
    const isImported = state.lazyLoad.isImported
        || (geom.type !== 'component' && !Number.isInteger(geom.id));

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

    // Build tags section (with internal _tags at the end). Tags the Postpass
    // converter had to invent for the parser - the `type` a relation loses on
    // its way into that database - are not the object's own, so they are not
    // shown as if a mapper had put them there
    let tagsHtml = '';
    const invented = synthesisedTagKeys(geom.tags);
    const allTags = sortTagKeys(Object.keys(geom.tags).filter(key => !invented.includes(key)));
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
export function openDetailModal(index) {
    if (state.geometries.length === 0) return;

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
export function closeDetailModal() {
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
    if (detailModalState.currentIndex < state.geometries.length - 1) {
        renderDetailModal(detailModalState.currentIndex + 1);
    }
}

/**
 * Wire both modals: their buttons, backdrops and keyboard shortcuts
 */
export function initModals() {
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
}
