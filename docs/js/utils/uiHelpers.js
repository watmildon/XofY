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
 * Show warnings
 * @param {Array<Object>} warnings - Array of warning objects with message/reason, osmType, and osmId
 */
export function showWarnings(warnings) {
    if (warnings.length === 0) {
        warningsDiv.classList.add('hidden');
        return;
    }

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
