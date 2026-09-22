/**
 * queryHandlers.js
 * Running queries: the Overpass tab's textarea, and the Search tab's
 * count-then-run flow behind it
 */

import { executeQuery } from '../overpassClient.js';
import { parseElements } from '../geometryParser.js';
import { state } from '../state/appState.js';
import { adoptGeometries, buildGrid } from '../utils/rendering.js';
import { cleanupLazyLoading } from '../utils/lazyLoading.js';
import { sortGeometries } from '../utils/sorting.js';
import {
    showLoading,
    hideLoading,
    showError,
    showWarnings,
    showComplexityError,
    showStats,
    escapeHtml
} from '../utils/uiHelpers.js';
import { createSearchTab, loadStoredSelection } from '../ui/searchTab.js';
import { saveSettings, getSortBy } from './settingsHandlers.js';

const queryTextarea = document.getElementById('overpass-query');
const submitBtn = document.getElementById('submit-btn');
const curatedSubmitBtn = document.getElementById('curated-submit-btn');
const featureComboboxRoot = document.getElementById('feature-combobox');
const areaComboboxRoot = document.getElementById('area-combobox');
const errorDiv = document.getElementById('error');
const warningsDiv = document.getElementById('warnings');
const statsDiv = document.getElementById('stats');
const gridContainer = document.getElementById('geometry-grid');
const groupByTagInput = document.getElementById('group-by-tag');

/**
 * How many features a search may match before the viewer warns instead of
 * drawing them. The grid appends 50 items at a time and never drops what it has
 * drawn, and every item is a 200px canvas scaled by devicePixelRatio (around
 * 640 KB of backing store each on a 2x screen), so a few thousand items is
 * already a gigabyte of canvas and dozens of scroll batches. The spec's own
 * example of an enormous result - 4,955 swimming pools in Nice - sits above it.
 */
const MAX_UNWARNED_RESULTS = 2000;

// The Search tab controller (created during init)
let searchTab = null;

// Guards the Search tab's count-then-run flow: one at a time, and a result
// that arrives after the selection changed is dropped
let searchSubmitBusy = false;
let searchSubmitToken = 0;
let pendingWarning = null;

// The grouping hint the Search tab last wrote. A curated feature still sets the
// hint as it always has; this only decides whether a later free-form search may
// clear it, which it does unless the user has since edited it themselves.
let appliedGroupBy = null;

/**
 * What the Search tab currently has selected, for share links
 * @returns {Object} The Search tab's state, or {} before it exists
 */
export function getSearchSelection() {
    return searchTab ? searchTab.getState() : {};
}

/**
 * Update the Overpass submit button enabled state based on query content
 */
export function updateOverpassSubmitState() {
    const hasQuery = queryTextarea.value.trim().length > 0;
    submitBtn.disabled = !hasQuery;
}

/**
 * Handle query submission
 */
async function handleSubmit() {
    return runQuery(queryTextarea.value.trim());
}

/**
 * Execute an Overpass query and render what comes back
 * @param {string} query - The Overpass QL to run
 */
export async function runQuery(query) {
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
        const data = await executeQuery(query, state.overpassUrl);
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

        // Apply sorting before storing, then work out bounds and the largest
        // dimension (for relative size scaling)
        adoptGeometries(sortGeometries(geometries, getSortBy()));

        // Show statistics
        showStats(
            data.elements ? data.elements.length : 0,
            state.geometries,
            warnings.length
        );

        // Create grid with lazy loading support
        buildGrid({ isImported: false });

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
 * Handle group by tag input change
 */
function handleGroupByTagChange() {
    // From now on this is the user's hint, not one a curated feature set
    appliedGroupBy = null;
    saveSettings();
}

/**
 * Sync a query built on the Search tab into the Overpass tab
 * @param {string} query - The Overpass QL query
 * @param {string|null} groupBy - Grouping hint to apply, or null to leave the
 *     user's own value alone (free-form searches have no hint of their own)
 */
function handleSearchQueryChange(query, groupBy) {
    queryTextarea.value = query;

    if (groupBy !== null) {
        groupByTagInput.value = groupBy;
        appliedGroupBy = groupBy;
    } else if (appliedGroupBy !== null && groupByTagInput.value === appliedGroupBy) {
        // The hint came from the curated feature we are leaving, not from the
        // user, so it must not follow them into a free-form search
        groupByTagInput.value = '';
        appliedGroupBy = null;
    }

    // Update Overpass submit button state since query changed
    updateOverpassSubmitState();
    saveSettings();
}

/**
 * Clear what the last search drew, so a message about the next one does not
 * appear above stale results
 */
function clearResults() {
    cleanupLazyLoading();
    state.geometries = [];
    gridContainer.innerHTML = '';
    statsDiv.classList.add('hidden');
}

/**
 * Read the total out of an `out count;` response
 * @param {Object} data - Overpass JSON response
 * @returns {number|null} The total, or null when the response has no count
 */
function readCount(data) {
    const element = data && Array.isArray(data.elements) ? data.elements[0] : null;
    const total = element && element.tags ? Number(element.tags.total) : NaN;
    return Number.isFinite(total) ? total : null;
}

/**
 * Show a message about a search that was not run, with a button that runs the
 * exact query it was raised for
 * @param {string} html - The message body
 * @param {string} query - The query "Run anyway" should execute
 * @param {string} [kind] - 'warning' (the neutral block) or 'error' (red)
 */
function showRunAnywayMessage(html, query, kind = 'warning') {
    // Too many results is not a failure, so it uses the neutral block; a count
    // that could not be run is an error and stays red
    const target = kind === 'warning' ? warningsDiv : errorDiv;

    target.innerHTML = `${html}
        <button type="button" class="submit-btn" id="run-anyway-btn">Run anyway</button>
    `;
    target.classList.remove('hidden');
    pendingWarning = target;
    target.scrollIntoView({ block: 'nearest' });

    const runAnyway = document.getElementById('run-anyway-btn');
    if (runAnyway) {
        // The captured query, not whatever the textarea holds by now
        runAnyway.addEventListener('click', () => {
            dismissCountWarning();
            runQuery(query);
        });
    }
}

/**
 * Take down a size warning, because it referred to a selection that has since
 * changed (or to a tab the user has left)
 */
export function dismissCountWarning() {
    // Whatever count is in flight is about the selection as it was
    searchSubmitToken++;

    if (!pendingWarning) {
        return;
    }
    pendingWarning.innerHTML = '';
    pendingWarning.classList.add('hidden');
    pendingWarning = null;
}

/**
 * Run a query from the Search tab, sizing it first when it could be enormous
 * @param {Object} plan - {query, countQuery, needsCount} from the Search tab
 */
async function handleSearchSubmit(plan) {
    // One run at a time: a second click must not start a second pair of queries
    if (!plan || searchSubmitBusy) {
        return;
    }

    dismissCountWarning();

    const token = ++searchSubmitToken;
    searchSubmitBusy = true;
    curatedSubmitBtn.disabled = true;

    try {
        if (!plan.needsCount || !plan.countQuery) {
            await runQuery(plan.query);
            return;
        }

        // Whatever the last search drew is no longer what the page is about
        clearResults();
        showLoading('Checking how many features match...');

        let total;
        try {
            total = readCount(await executeQuery(plan.countQuery, state.overpassUrl));
        } catch (error) {
            console.error('Count query failed:', error);
            hideLoading();

            if (token === searchSubmitToken) {
                showRunAnywayMessage(
                    `<strong>Could not check the size of this search</strong>
                    <p>${escapeHtml(error.message)}</p>
                    <p class="suggestion">💡 The search itself may still work, but it could be very large.</p>`,
                    plan.query,
                    'error'
                );
            }
            return;
        }

        hideLoading();

        // The selection changed while the count was in flight
        if (token !== searchSubmitToken) {
            return;
        }

        if (total === null) {
            // Nothing to go on, so run it rather than block the user
            await runQuery(plan.query);
            return;
        }

        if (total === 0) {
            showError('No features match - check the feature and the area. If the area was only added to OpenStreetMap recently, Overpass may not have built its boundary yet.');
            errorDiv.scrollIntoView({ block: 'nearest' });
            return;
        }

        if (total > MAX_UNWARNED_RESULTS) {
            showRunAnywayMessage(
                `<strong>That is a lot of features</strong>
                <p>This search matches ${total.toLocaleString()} features. Drawing that many will make the page very slow.</p>
                <p class="suggestion">💡 Try a smaller area, or narrow the feature down.</p>`,
                plan.query
            );
            return;
        }

        await runQuery(plan.query);
    } finally {
        searchSubmitBusy = false;
        // The selection may have changed while this ran
        curatedSubmitBtn.disabled = !(searchTab && searchTab.isReady());
    }
}

/**
 * Create the Search tab and wire the Overpass tab's controls
 * @param {Object} options
 * @param {Object|null} options.urlSelection - A selection from a shared link,
 *     or null to restore the last one from localStorage
 */
export function initQueryHandlers({ urlSelection }) {
    // Search tab: two comboboxes and the query wiring behind them
    searchTab = createSearchTab({
        featureRoot: featureComboboxRoot,
        areaRoot: areaComboboxRoot,
        submitButton: curatedSubmitBtn,
        onQueryChange: handleSearchQueryChange,
        onSubmit: handleSearchSubmit,
        onSelectionChange: dismissCountWarning,
        onError: showError
    });

    if (urlSelection) {
        // A shared link rebuilds its query
        searchTab.applyState(urlSelection);
    } else {
        // Restore the last selection, but leave the query textarea as the user
        // left it - it is saved separately and may have been edited by hand
        searchTab.applyState(loadStoredSelection(), { buildQuery: false });
    }

    submitBtn.addEventListener('click', handleSubmit);
    groupByTagInput.addEventListener('blur', handleGroupByTagChange);

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
}
