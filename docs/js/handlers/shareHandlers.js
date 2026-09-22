/**
 * shareHandlers.js
 * Share links: reading one from the address bar on load, and the share button
 */

import { buildShareURL, decodeParamsToState } from '../utils/sharing.js';
import { showError } from '../utils/uiHelpers.js';
import { getCurrentTab } from '../ui/tabs.js';
import { getQueryLang } from '../ui/queryTab.js';
import { getSearchSelection } from './queryHandlers.js';

const shareBtn = document.getElementById('share-btn');
const queryTextarea = document.getElementById('overpass-query');
const fillColorInput = document.getElementById('fill-color');
const scaleToggle = document.getElementById('scale-toggle');
const groupByTagInput = document.getElementById('group-by-tag');

/**
 * Collect the shareable state from the UI
 * @returns {Object} State for utils/sharing.js
 */
function getShareableState() {
    const selection = getSearchSelection();

    return {
        tab: getCurrentTab(),
        feature: selection.feature,
        x: selection.x,
        xLabel: selection.xLabel,
        xElementTypes: selection.xElementTypes,
        area: selection.area,
        y: selection.y,
        yLabel: selection.yLabel,
        query: queryTextarea.value,
        queryLang: getQueryLang(),
        fillColor: fillColorInput.value,
        scaleToggle: scaleToggle.checked,
        groupByTag: groupByTagInput.value
    };
}

/**
 * Encode current state to URL parameters
 * @returns {string} URL with encoded parameters
 */
function encodeStateToURL() {
    return buildShareURL(getShareableState(), window.location.href);
}

/**
 * Decode URL parameters and apply to state
 * @returns {Object|null} Decoded state or null if no parameters
 */
export function decodeURLParams() {
    return decodeParamsToState(window.location.search);
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
 * Wire the share button
 */
export function initShareHandlers() {
    shareBtn.addEventListener('click', handleShare);
}
