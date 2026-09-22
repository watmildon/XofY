/**
 * uiHelpers.js
 * The result panel's messages: loading, errors, warnings and the stats line.
 * Owns the elements it writes to.
 */

const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const warningsDiv = document.getElementById('warnings');
const statsDiv = document.getElementById('stats');
const submitBtn = document.getElementById('submit-btn');

/**
 * Show loading state
 * @param {string} [message] - Text under the spinner
 */
export function showLoading(message) {
    const text = loadingDiv.querySelector('p');
    if (text) {
        text.textContent = message || 'Loading geometries...';
    }

    loadingDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    warningsDiv.classList.add('hidden');
    statsDiv.classList.add('hidden');
    submitBtn.disabled = true;
}

/**
 * Hide loading state
 */
export function hideLoading() {
    loadingDiv.classList.add('hidden');
    submitBtn.disabled = false;
}

/**
 * Show error message
 * @param {string} message - Error message to display
 */
export function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

/**
 * Escape text that is about to go into innerHTML
 * @param {string} text - Raw text, possibly from a server
 * @returns {string} Text safe to interpolate
 */
export function escapeHtml(text) {
    const holder = document.createElement('span');
    holder.textContent = String(text ?? '');
    return holder.innerHTML;
}

/**
 * Warning types that are remarks about something that was drawn rather than
 * something that was left out. Everything else - including the warnings that
 * carry no type at all, and the colour conflicts that predate this split - is
 * a skip, so that what the Overpass backend has always reported is unchanged.
 */
const NOTE_WARNING_TYPES = ['gap', 'size'];

/**
 * Whether a warning means something was left out of the results
 * @param {Object} warning - A warning from parseElements
 * @returns {boolean} True when nothing was drawn for it
 */
function isSkipWarning(warning) {
    return !warning || !NOTE_WARNING_TYPES.includes(warning.type);
}

/**
 * How many warnings mean something was left out. The stats line counts these
 * and not the notes, so that a hundred remarks about things that were drawn do
 * not read as a hundred things that were not.
 * @param {Array<Object>} warnings - Warnings from parseElements
 * @returns {number} How many of them are skips
 */
export function countSkippedWarnings(warnings) {
    return Array.isArray(warnings) ? warnings.filter(isSkipWarning).length : 0;
}

/**
 * Show warnings
 * @param {Array<Object>} warnings - Array of warning objects with message/reason, osmType, and osmId
 */
export function showWarnings(warnings) {
    if (warnings.length === 0) {
        warningsDiv.classList.add('hidden');
        return;
    }

    // "Skipped 139 item(s)" over a list of notes about 139 items that were all
    // drawn is simply untrue, so the two are counted and headlined apart
    const skipped = warnings.filter(isSkipWarning);
    const notes = warnings.filter(warning => !isSkipWarning(warning));

    // Helper function to format a warning with clickable OSM link
    function formatWarning(warning) {
        // Get the warning text - support both 'message' and 'reason' fields
        const warningText = warning.message || warning.reason;

        if (!warningText) {
            console.error('[uiHelpers.js] Warning missing both message and reason:', warning);
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

    /**
     * One headed list of at most ten warnings
     * @param {string} heading - The heading text
     * @param {Array<Object>} items - The warnings to list
     * @returns {string} HTML, or '' when there is nothing to list
     */
    function section(heading, items) {
        if (items.length === 0) {
            return '';
        }
        return `<h3>${heading}:</h3>
        <ul>
            ${items.slice(0, 10).map(w => `<li>${formatWarning(w)}</li>`).join('')}
            ${items.length > 10 ? `<li>... and ${items.length - 10} more</li>` : ''}
        </ul>`;
    }

    warningsDiv.innerHTML = `
        ${section(`Skipped ${skipped.length} item(s)`, skipped)}
        ${section(`${notes.length} note(s)`, notes)}
    `;
    warningsDiv.classList.remove('hidden');
}

/**
 * Show complexity error (network too complex)
 * @param {Error} error - The complexity error object
 */
export function showComplexityError(error) {
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
export function showStats(totalCount, geometries, skippedCount) {
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
