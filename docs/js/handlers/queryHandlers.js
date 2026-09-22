/**
 * queryHandlers.js
 * Running queries: the Query tab's textarea, and the Search tab's
 * count-then-run flow behind it. Either can run on either backend - the
 * textarea against whichever service speaks the language it is set to, the
 * Search tab against the data source in Settings.
 */

import { executeQuery } from '../overpassClient.js';
import { executeSql, readCountResult, getPostpassTimeout } from '../postpassClient.js';
import { parseElements } from '../geometryParser.js';
import { postpassToElements, dropRouteGapWarnings } from '../search/postpassResults.js';
import { shapeForTagCount } from '../search/queryPlan.js';
import { getTagCount } from '../search/taginfo.js';
import { state, languageBackend, detectQueryLanguage } from '../state/appState.js';
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
    countSkippedWarnings,
    escapeHtml
} from '../utils/uiHelpers.js';
import { createSearchTab, loadStoredSelection } from '../ui/searchTab.js';
import { getQueryLang } from '../ui/queryTab.js';
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
// Set when a run was dropped mid-flight, so the step that notices can say so
let abandoned = false;

// The text the Search tab last wrote into the textarea. Rewriting it in
// another language is only ever right while it still holds exactly this: past
// that point the text is the user's, and theirs to keep
let syncedQueryText = null;

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

/** What each language is called when the user is told they picked the other one */
const LANGUAGE_NAMES = { ql: 'Overpass QL', sql: 'Postpass SQL' };

/** Said only when the second service of the day has also let the user down */
const BOTH_STRUGGLING = 'Both services seem to be struggling right now - try again in a few minutes.';

/**
 * Handle query submission from the Query tab. What the textarea holds is run
 * against whichever backend speaks the language the tab is set to, because a
 * SELECT cannot be sent to Overpass whatever the data source setting says.
 */
async function handleSubmit() {
    const text = queryTextarea.value.trim();
    const lang = getQueryLang();
    const looksLike = detectQueryLanguage(text);

    // Sending it anyway would come back as a syntax error from a server the
    // user did not mean to ask, which says nothing about what to do next
    if (looksLike && looksLike !== lang) {
        showError(`This looks like ${LANGUAGE_NAMES[looksLike]} - switch the language select above.`);
        return;
    }

    return runQuery(text, { backend: languageBackend(lang) });
}

/**
 * Ask a backend for the elements a query matches
 * @param {string} query - Overpass QL or Postpass SQL
 * @param {string} backend - Which one it is for
 * @returns {Promise<Array<Object>>} Overpass-shaped elements
 */
async function fetchElements(query, backend) {
    if (backend === 'postpass') {
        // Postpass answers GeoJSON, which is turned into the same elements
        // Overpass would have sent - real ids and types included
        return postpassToElements(await executeSql(query));
    }

    const data = await executeQuery(query, state.overpassUrl);
    console.log('Received data:', data);
    return data.elements || [];
}

/**
 * Execute a query and render what comes back
 * @param {string} query - Overpass QL, or Postpass SQL when the backend says so
 * @param {Object} [options] - How to run it
 * @param {string} [options.backend] - 'overpass' (the default) or 'postpass'
 * @param {Function} [options.onFailure] - (error) => boolean; a chance to show
 *     something better than the plain error message. Returning true means it
 *     was handled and nothing more should be shown.
 */
export async function runQuery(query, options = {}) {
    const backend = options.backend === 'postpass' ? 'postpass' : 'overpass';

    if (!query) {
        showError(backend === 'postpass' ? 'Please enter a Postpass query' : 'Please enter an Overpass query');
        return;
    }

    showLoading();

    // Cleanup any previous lazy loading state
    cleanupLazyLoading();

    try {
        // Execute query
        console.log('Executing query...');
        const elements = await fetchElements(query, backend);

        // Parse elements with grouping options
        const groupByTag = groupByTagInput.value.trim();
        const parseOptions = {
            groupByEnabled: groupByTag.length > 0,
            groupByTag: groupByTag || 'name'
        };
        const parsed = parseElements(elements, parseOptions);
        const geometries = parsed.geometries;
        // Postpass merges a route's ways into maximal runs, so its routes
        // always look gappy to the parser; that is about the backend, not
        // about the data, and saying it of every route says nothing
        const warnings = backend === 'postpass'
            ? dropRouteGapWarnings(parsed.warnings)
            : parsed.warnings;
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

        // Show statistics. Only the skips are "skipped": a note is about
        // something that is on the screen
        showStats(
            elements.length,
            state.geometries,
            countSkippedWarnings(warnings)
        );

        // Create grid with lazy loading support
        buildGrid({ isImported: false });

        hideLoading();

        // Save settings after successful query
        saveSettings();

    } catch (error) {
        console.error('Error:', error);
        hideLoading();

        // A request this page abandoned on purpose is not news
        if (error && error.name === 'AbortError') {
            return;
        }

        // Handle complexity errors specially
        if (error.type === 'NETWORK_TOO_COMPLEX') {
            showComplexityError(error);
        } else if (!options.onFailure || !options.onFailure(error)) {
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
 * Sync a query built on the Search tab into the Query tab
 * @param {string} query - The query, in the Query tab's language
 * @param {string|null} groupBy - Grouping hint to apply, or null to leave the
 *     user's own value alone (free-form searches have no hint of their own)
 */
function handleSearchQueryChange(query, groupBy) {
    queryTextarea.value = query;
    syncedQueryText = query;

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
 * Show a message about a search that was not run, with a button that does
 * something about it
 * @param {string} html - The message body
 * @param {Function} run - What the button should do
 * @param {Object} [options] - How to show it
 * @param {string} [options.kind] - 'warning' (the neutral block) or 'error' (red)
 * @param {string} [options.label] - The button's text
 */
function showRunAnywayMessage(html, run, options = {}) {
    const { kind = 'warning', label = 'Run anyway' } = options;
    // Too many results is not a failure, so it uses the neutral block; a count
    // that could not be run is an error and stays red
    const target = kind === 'warning' ? warningsDiv : errorDiv;

    target.innerHTML = `${html}
        <button type="button" class="submit-btn" id="run-anyway-btn">${label}</button>
    `;
    target.classList.remove('hidden');
    pendingWarning = target;
    target.scrollIntoView({ block: 'nearest' });

    const runAnyway = document.getElementById('run-anyway-btn');
    if (runAnyway) {
        // The button cannot outlive the selection it was raised for: any change
        // to the selection dismisses it (invalidateSearch), so `run` may read
        // the current selection or hold a captured query, as its caller chose
        runAnyway.addEventListener('click', () => {
            dismissCountWarning();
            run();
        });
    }
}

/**
 * Offer Overpass after Postpass could not answer.
 *
 * Never done silently: the two services see the planet slightly differently
 * and one of them is the user's own setting, so swapping without saying so
 * would make a result mean something other than what was asked for.
 *
 * The button re-enters the whole search flow rather than firing the query
 * directly, so that the count-first guardrail applies. It matters more here
 * than anywhere else: the public Overpass servers are exactly the ones an
 * enormous query should not be thrown at unchecked.
 * @param {string} heading - What went wrong, in a few words
 * @param {string} detail - The longer explanation, already escaped
 * @returns {boolean} True when the offer was shown, false when there is no
 *     Overpass query to offer (so the caller shows the plain error instead)
 */
function offerOverpass(heading, detail) {
    if (!searchTab || !searchTab.buildPlan({ backend: 'overpass' })) {
        return false;
    }

    showRunAnywayMessage(
        `<strong>${heading}</strong>
        <p>${detail}</p>
        <p class="suggestion">💡 The same search can run on Overpass instead.</p>`,
        () => handleSearchSubmit(searchTab.buildPlan({ backend: 'overpass' }), { afterPostpassFailed: true }),
        { kind: 'error', label: 'Try Overpass instead' }
    );
    return true;
}

/**
 * Turn a Postpass failure into the words to put in front of the offer
 * @param {Error} error - What the client threw
 * @returns {{heading: string, detail: string}} Heading and detail, escaped
 */
function describePostpassFailure(error) {
    if (error && error.timeout) {
        const count = Math.round(getPostpassTimeout() / 1000);
        const seconds = `${count} second${count === 1 ? '' : 's'}`;
        return {
            heading: `Postpass did not answer within ${seconds}`,
            detail: `The query ran for longer than ${seconds}, which usually means the area or the feature is too broad.`
        };
    }
    if (error && error.status >= 500) {
        return {
            heading: `Postpass is unavailable (${error.status})`,
            detail: 'The service is not answering right now. This happens occasionally and is nothing to do with the search.'
        };
    }
    if (error && error.status === 0) {
        return {
            heading: 'Could not reach Postpass',
            detail: 'Please check your connection.'
        };
    }
    return {
        heading: 'Postpass could not run this search',
        detail: escapeHtml(error && error.message ? error.message : 'The query was refused.')
    };
}

/**
 * Take down a size warning, because it is no longer about anything - the
 * selection changed, or the user left the tab it belonged to.
 *
 * This does not touch a search that is running. Leaving a tab is not a reason
 * to abandon one, and neither is redrawing the textarea in another language.
 */
export function dismissCountWarning() {
    if (!pendingWarning) {
        return;
    }
    pendingWarning.innerHTML = '';
    pendingWarning.classList.add('hidden');
    pendingWarning = null;
}

/**
 * Abandon whatever search is in flight, because the selection it was about no
 * longer exists. The token is what every step of the flow checks before it
 * puts anything on the screen.
 */
function invalidateSearch() {
    if (searchSubmitBusy) {
        // Something is actually running, so its disappearance needs explaining
        abandoned = true;
    }
    searchSubmitToken++;
    dismissCountWarning();
}

/**
 * Say that a running search was dropped, so that a page which was busy a
 * moment ago does not simply go blank
 */
function showAbandonedMessage() {
    if (!abandoned) {
        return;
    }
    abandoned = false;
    warningsDiv.innerHTML = '<strong>That search was cancelled</strong>'
        + '<p>The feature or the area changed while it was running. Press Execute to run the new one.</p>';
    warningsDiv.classList.remove('hidden');
    pendingWarning = warningsDiv;
}

/**
 * Ask a backend how many features a search matches
 * @param {Object} plan - The plan being run
 * @returns {Promise<number|null>} The total, or null when there is none to read
 */
async function runCountQuery(plan) {
    if (plan.backend === 'postpass') {
        // The count is asked for as plain rows rather than GeoJSON: there is no
        // geometry in it, and a FeatureCollection of one number is silly
        return readCountResult(await executeSql(plan.countQuery, { geojson: false }));
    }
    return readCount(await executeQuery(plan.countQuery, state.overpassUrl));
}

/**
 * Decide which of the two Postpass query shapes to use and rebuild the plan
 * for it.
 *
 * The planner cannot choose between them, and the wrong one for a given tag
 * runs for minutes instead of seconds, so how rare the tag is has to be known
 * before the query is written. The count usually comes out of memory (a preset
 * or a taginfo row the user picked seeded it); when it does not, taginfo is
 * asked once and the answer kept.
 * @param {Object} plan - The geometry-shaped plan the Search tab built
 * @returns {Promise<Object>} The plan to actually run
 */
async function planWithChosenShape(plan) {
    // No boundary in the query means both shapes are the same statement
    if (!plan.estimateFilters || plan.estimateFilters.length === 0) {
        return plan;
    }

    // A curated feature may already know; only ask when nothing does
    const count = plan.estimateCount !== null && plan.estimateCount !== undefined
        ? plan.estimateCount
        : await getTagCount(plan.estimateFilters);
    const shape = shapeForTagCount(count);

    console.log(`Postpass shape: ${shape} (tag count ${count === null ? 'unknown' : count})`);

    if (shape === 'geometry') {
        return plan;
    }
    return searchTab.buildPlan({ backend: 'postpass', shape }) || plan;
}

/**
 * Run a query from the Search tab, sizing it first when it could be enormous
 * @param {Object} submitted - {query, countQuery, needsCount} from the Search tab
 * @param {Object} [runOptions] - How this run came about
 * @param {boolean} [runOptions.afterPostpassFailed] - True when this is the
 *     Overpass attempt offered after Postpass could not answer, so that a
 *     second failure can say that both services are having a bad day
 */
async function handleSearchSubmit(submitted, runOptions = {}) {
    // One run at a time: a second click must not start a second pair of queries
    if (!submitted || searchSubmitBusy) {
        return;
    }

    dismissCountWarning();
    abandoned = false;

    const token = ++searchSubmitToken;
    searchSubmitBusy = true;
    curatedSubmitBtn.disabled = true;

    try {
        let plan = submitted;

        if (plan.backend === 'postpass') {
            // A tag the Postpass database does not keep would match nothing at
            // all, which reads like "there are none here" rather than like the
            // question being unanswerable
            if (plan.unsupportedKeys && plan.unsupportedKeys.length > 0) {
                clearResults();
                const keys = plan.unsupportedKeys.map(key => `<code>${escapeHtml(key)}</code>`).join(', ');
                if (!offerOverpass(
                    'Postpass cannot search this tag',
                    `The ${keys} tag is used to build the Postpass database and is not kept in it, so a search for it would find nothing.`
                )) {
                    showError('Postpass cannot search the type tag. Choose Overpass as the data source in Settings.');
                }
                return;
            }

            showLoading('Working out how to ask...');
            try {
                plan = await planWithChosenShape(plan);
            } catch (error) {
                // Only an abort gets here; not knowing is not an error
                console.warn('Tag count lookup abandoned:', error);
                hideLoading();
                return;
            }

            // The selection changed while taginfo was being asked
            if (token !== searchSubmitToken) {
                hideLoading();
                showAbandonedMessage();
                return;
            }
        }

        const failed = (error) => {
            console.error('Query failed:', error);

            if (token !== searchSubmitToken) {
                return false;
            }
            if (plan.backend === 'postpass') {
                const { heading, detail } = describePostpassFailure(error);
                return offerOverpass(heading, detail);
            }
            // Overpass, and only because Postpass had already given up
            if (runOptions.afterPostpassFailed) {
                showError(`${error.message || 'The query failed.'} ${BOTH_STRUGGLING}`);
                return true;
            }
            return false;
        };

        if (!plan.needsCount || !plan.countQuery) {
            await runQuery(plan.query, { backend: plan.backend, onFailure: failed });
            return;
        }

        // Whatever the last search drew is no longer what the page is about
        clearResults();
        showLoading('Checking how many features match...');

        let total;
        try {
            total = await runCountQuery(plan);
        } catch (error) {
            console.error('Count query failed:', error);
            hideLoading();

            if (token !== searchSubmitToken) {
                showAbandonedMessage();
                return;
            }
            if (plan.backend === 'postpass') {
                const { heading, detail } = describePostpassFailure(error);
                if (offerOverpass(heading, detail)) {
                    return;
                }
            }

            showRunAnywayMessage(
                `<strong>Could not check the size of this search</strong>
                <p>${escapeHtml(error.message)}</p>
                <p class="suggestion">💡 The search itself may still work, but it could be very large.</p>
                ${runOptions.afterPostpassFailed ? `<p>${BOTH_STRUGGLING}</p>` : ''}`,
                () => runQuery(plan.query, { backend: plan.backend, onFailure: failed }),
                { kind: 'error' }
            );
            return;
        }

        hideLoading();

        // The selection changed while the count was in flight
        if (token !== searchSubmitToken) {
            showAbandonedMessage();
            return;
        }

        if (total === null) {
            // Nothing to go on, so run it rather than block the user
            await runQuery(plan.query, { backend: plan.backend, onFailure: failed });
            return;
        }

        if (total === 0) {
            showError(plan.backend === 'postpass'
                ? 'No features match - check the feature and the area. If the area was only added to OpenStreetMap recently, Postpass may not have it yet.'
                : 'No features match - check the feature and the area. If the area was only added to OpenStreetMap recently, Overpass may not have built its boundary yet.');
            errorDiv.scrollIntoView({ block: 'nearest' });
            return;
        }

        if (total > MAX_UNWARNED_RESULTS) {
            showRunAnywayMessage(
                `<strong>That is a lot of features</strong>
                <p>This search matches ${total.toLocaleString()} features. Drawing that many will make the page very slow.</p>
                <p class="suggestion">💡 Try a smaller area, or narrow the feature down.</p>`,
                // The same failure handling as the direct run: a Postpass
                // failure after "Run anyway" must still offer Overpass
                () => runQuery(plan.query, { backend: plan.backend, onFailure: failed }),
                {}
            );
            return;
        }

        await runQuery(plan.query, { backend: plan.backend, onFailure: failed });
    } finally {
        searchSubmitBusy = false;
        // The selection may have changed while this ran
        curatedSubmitBtn.disabled = !(searchTab && searchTab.isReady());
    }
}

/**
 * Rewrite the textarea in whatever language the Query tab is now showing.
 *
 * Only while it still holds exactly what the Search tab last put there. Once
 * the user has edited it - or typed their own query with no selection at all -
 * the text is theirs, and a change of data source is not a reason to throw it
 * away. Nothing is announced either: redrawing the box is not a change of
 * selection, so a search that is running keeps running.
 */
export function resyncSearchQuery() {
    if (!searchTab || syncedQueryText === null || queryTextarea.value !== syncedQueryText) {
        return;
    }
    searchTab.syncQuery({ announce: false });
}

/**
 * Create the Search tab and wire the Query tab's controls
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
        onSelectionChange: invalidateSearch,
        onError: showError,
        // Execute runs on the data source; the textarea shows whichever
        // language the Query tab is set to, which follows it unless the user
        // has said otherwise
        getBackend: () => state.backend,
        getDisplayBackend: () => languageBackend(getQueryLang())
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
