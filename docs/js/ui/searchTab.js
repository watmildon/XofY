/**
 * searchTab.js
 * The "X of Y" search tab: a feature combobox, an area combobox, and the rules
 * that turn a committed pair into an Overpass query.
 *
 * X can be a curated feature, an iD preset matched from plain words, or tags
 * the user typed (with key and value suggestions from taginfo). Y can be a
 * curated area or a place found with Nominatim, which is only asked on Enter or
 * on the "Search for ..." row.
 *
 * What a committed pair *is* lives in search/selection.js, which has no DOM;
 * this module owns the two fields and the traffic between them.
 *
 * Anything that is not a curated feature in a curated area gets its size
 * checked with `out count;` before it runs - see the plan handed to onSubmit.
 */

import { buildQueryPlan } from '../search/queryPlan.js';
import { normaliseTagExpression, stringifyFilters } from '../search/tagParser.js';
import { loadPresets, presetToFilters } from '../search/presets.js';
import {
    canCommitTypedText,
    canCommitAsKeyExists,
    typedFeature,
    presetFeature,
    curatedFeature,
    featureLabel,
    areaLabel,
    areaAllowedFor,
    selectionToState,
    selectionFromState,
    storeSelection
} from '../search/selection.js';
import { createCombobox } from './combobox.js';
import { createFeatureSuggestions } from './featureSuggestions.js';
import { createAreaSuggestions } from './areaSuggestions.js';

// Re-exported so main.js and the existing tests keep importing them from here
export {
    loadStoredSelection,
    isCommittableExpression,
    canCommitTypedText,
    canCommitAsKeyExists
} from '../search/selection.js';

/** Shown when nothing at all matches what was typed */
const NO_MATCH_MESSAGE = 'No matches - try another word, or a tag like leisure=park';

/**
 * Build the search tab
 * @param {Object} options - Wiring
 * @param {HTMLElement} options.featureRoot - Container for the feature combobox
 * @param {HTMLElement} options.areaRoot - Container for the area combobox
 * @param {HTMLElement} options.submitButton - The Execute button
 * @param {Function} options.onQueryChange - (query, groupBy) => void, groupBy null means "leave it alone"
 * @param {Function} options.onSubmit - (plan) => void, run this query plan
 * @param {Function} [options.onSelectionChange] - () => void, the selection changed
 * @param {Function} [options.onError] - (message) => void
 * @returns {Object} Controller
 */
export function createSearchTab(options) {
    const { featureRoot, areaRoot, submitButton } = options;

    // null, {kind: 'curated', key} or
    // {kind: 'free', filters, expression, label, elementTypes}
    let feature = null;
    // null, {kind: 'curated', key} or {kind: 'place', ref, label}
    let area = null;

    // The sources behind the feature list. Two of the three answer late (the
    // preset file and taginfo), so they are given a way to ask the field for a
    // re-render when something arrives.
    const featureSources = createFeatureSuggestions({ refresh: () => featureCombobox.refresh() });

    // The curated areas on offer depend on the feature, so the list reads it
    // when it is built rather than being told about every change
    const areaSources = createAreaSuggestions({ getFeature: () => feature });

    /**
     * Commit the curated area whose name is exactly the typed text
     * @param {string} text - The typed text
     * @returns {boolean} True when something was committed
     */
    function commitExactAreaName(text) {
        const named = areaSources.findExactArea(text);

        if (!named) {
            return false;
        }

        area = named;
        areaCombobox.setValue(areaLabel(area), { value: area });
        syncQuery();
        persist();
        return true;
    }

    /**
     * Remember the committed selection. Every commit handler ends with this,
     * so nothing on the save path - reading the selection included - may throw
     * back into one of them.
     */
    function persist() {
        try {
            storeSelection(getState());
        } catch (e) {
            console.warn('Failed to save the selection:', e);
        }
    }

    /**
     * Drop the area selection and empty its field
     */
    function clearArea() {
        area = null;
        areaCombobox.setValue('');
    }

    /**
     * Enable or disable Execute, and say through its tooltip what is still
     * missing - the only place a half-finished selection is explained
     * @param {Object|null} plan - The current query plan, if there is one
     */
    function updateSubmitState(plan) {
        submitButton.disabled = !plan;
        submitButton.title = plan
            ? ''
            : !feature
                ? 'Pick a feature from the list'
                : 'Pick an area from the list';
    }

    /**
     * Tell the caller that the selection changed, so anything it was showing
     * about the previous one (a size warning, say) can be dismissed
     */
    function announceChange() {
        if (options.onSelectionChange) {
            options.onSelectionChange();
        }
    }

    /**
     * The plan for the committed pair, or null when there is not one
     * @returns {Object|null} Plan from search/queryPlan.js
     */
    function currentPlan() {
        try {
            return buildQueryPlan(feature, area);
        } catch (error) {
            // A stored or shared area that the query builder will not accept
            console.warn('Could not build the query:', error);
            clearArea();
            updateSubmitState(null);
            if (options.onError) {
                options.onError('That area cannot be searched. Please choose another one.');
            }
            return null;
        }
    }

    /**
     * Rebuild the query when both halves are committed, and set the button state
     * @returns {Object|null} The plan that was synced, or null
     */
    function syncQuery() {
        announceChange();

        const plan = currentPlan();
        updateSubmitState(plan);

        if (plan && options.onQueryChange) {
            options.onQueryChange(plan.query, plan.groupBy);
        }

        return plan;
    }

    /**
     * After the feature changes, make sure the area is still allowed
     */
    function revalidateArea() {
        if (!areaAllowedFor(feature, area)) {
            clearArea();
        }
    }

    /**
     * Commit tags the user typed, if they are unmistakably tags
     * @param {string} text - The typed expression
     * @returns {boolean} True when it was committed
     */
    function commitTypedTags(text) {
        const typed = typedFeature(text);

        if (!typed) {
            return false;
        }

        feature = typed;
        revalidateArea();
        syncQuery();
        persist();
        return true;
    }

    /**
     * Commit the feature whose name is exactly the typed text, if there is one.
     * Used when focus leaves the field: someone who typed a name in full and
     * clicked away meant that feature.
     * @param {string} text - The typed text
     * @returns {boolean} True when something was committed
     */
    function commitExactFeatureName(text) {
        const named = featureSources.findExactFeature(text);

        if (!named) {
            return false;
        }

        feature = named;
        featureCombobox.setValue(featureLabel(feature), { value: feature });
        revalidateArea();
        syncQuery();
        persist();
        return true;
    }

    /**
     * Show a label that came from a link only once a feature of that name is
     * found to carry exactly these tags. Otherwise a link could put "Swimming
     * Pool" above a query for something else entirely.
     * @param {Object} target - The feature this label claims to describe
     * @param {string} label - The claimed name
     */
    async function verifyLabel(target, label) {
        let presets;

        try {
            presets = await loadPresets();
        } catch (error) {
            return;
        }

        const match = presets.find(preset => (
            preset.name === label && stringifyFilters(presetToFilters(preset)) === target.expression
        ));

        // Only if nothing has changed in the meantime
        if (match && feature === target && featureCombobox.input.value === target.expression) {
            target.label = label;
            featureCombobox.setValue(label, { value: target });
        }
    }

    /**
     * Handle Enter in the feature field. Tag text is committed as typed;
     * anything else takes the best suggestion on offer, because a word like
     * "lighthouse" means the Lighthouse feature, not the key `lighthouse`.
     * @param {string} text - The typed text
     */
    async function commitFromEnter(text) {
        if (commitTypedTags(text)) {
            return;
        }

        // Give the feature list a moment, but never wait on it indefinitely
        await featureSources.waitForPresets();
        await featureCombobox.refresh();

        // Only rows that stand for a whole feature: a tag key row would leave
        // half a filter behind
        if (await featureCombobox.pickBest(text, item => !item.splice)) {
            return;
        }

        // Nothing matched. A word taginfo knows as a key becomes a key search;
        // a misspelling gets told so rather than searching for nothing.
        if (canCommitAsKeyExists(text) && featureSources.isKnownTagKey(text)) {
            const expression = normaliseTagExpression(text);
            if (commitTypedTags(expression)) {
                featureCombobox.setValue(expression, { value: feature });
                return;
            }
        }

        if (text.trim()) {
            featureCombobox.showStatus(NO_MATCH_MESSAGE, 'empty');
        }
    }

    /**
     * Ask Nominatim about the typed place name and show the answers
     * @param {string} query - The place name
     */
    function runPlaceSearch(query) {
        areaSources.searchPlaces(areaCombobox, query);
    }

    const featureCombobox = createCombobox(featureRoot, {
        inputId: 'feature-input',
        placeholder: 'Swimming pools, leisure=park...',
        getSuggestions: featureSources.getSuggestions,
        getEmptyMessage: (text, { committed }) => {
            if (committed || !text.trim()) {
                return null;
            }
            // Valid tag text with nothing to suggest is not a failure
            return canCommitTypedText(text) ? 'Press Enter to use these tags' : NO_MATCH_MESSAGE;
        },
        onInput: () => {
            feature = null;
            updateSubmitState(null);
            announceChange();
        },
        onEnterText: (text) => commitFromEnter(text),
        onBlurText: (text, { committed }) => {
            // Only unmistakable tag text commits by itself. A word the user was
            // half way through typing must never turn into a key-exists search.
            if (committed || feature) {
                return;
            }
            if (commitTypedTags(text) || commitExactFeatureName(text)) {
                return;
            }
            // Nothing was chosen, and the disabled button now says why
            featureCombobox.setInvalid(Boolean(text.trim()));
        },
        onPick: (item) => {
            if (item.value.kind === 'tagKey') {
                // Half a filter: wait for the value before committing
                return;
            }
            if (item.value.kind === 'tagValue') {
                commitTypedTags(featureCombobox.input.value);
                return;
            }

            if (item.value.kind === 'preset') {
                feature = presetFeature(item.value.preset);
            } else {
                feature = curatedFeature(item.value.key);
            }

            revalidateArea();
            syncQuery();
            persist();
        }
    });

    const areaCombobox = createCombobox(areaRoot, {
        inputId: 'area-input',
        placeholder: 'Seattle, Nice, France...',
        getSuggestions: areaSources.getSuggestions,
        getActionRow: areaSources.getActionRow,
        onInput: () => {
            area = null;
            updateSubmitState(null);
            announceChange();
        },
        onEnterText: (text) => runPlaceSearch(text),
        onBlurText: (text, { committed }) => {
            if (committed || area) {
                return;
            }
            if (commitExactAreaName(text)) {
                return;
            }
            areaCombobox.setInvalid(Boolean(text.trim()));
        },
        onPick: (item) => {
            if (item.value.kind === 'search') {
                runPlaceSearch(item.value.query);
                return;
            }

            area = item.value;
            syncQuery();
            persist();
        }
    });

    /**
     * The committed selection, in the shape utils/sharing.js expects
     * @returns {Object} {feature, x, xLabel, xElementTypes, area, y, yLabel}
     */
    function getState() {
        return selectionToState(feature, area);
    }

    /**
     * Apply a selection that came from a URL or from storage
     * @param {Object} state - {feature, x, xLabel, xElementTypes, area, y, yLabel}
     * @param {Object} [applyOptions] - Behaviour
     * @param {boolean} [applyOptions.buildQuery] - Rebuild the Overpass query (default true)
     * @returns {boolean} True when a complete selection was applied
     */
    function applyState(state, applyOptions = {}) {
        if (!state) {
            updateSubmitState(null);
            return false;
        }

        const restored = selectionFromState(state);

        if (restored.feature) {
            feature = restored.feature;
            featureCombobox.setValue(featureLabel(feature), { value: feature });

            if (restored.pendingLabel) {
                verifyLabel(feature, restored.pendingLabel);
            }
        }

        if (restored.area) {
            area = restored.area;
            areaCombobox.setValue(areaLabel(area), { value: area });
        }

        // The feature may restrict which areas are allowed
        revalidateArea();

        const complete = Boolean(feature && area);
        updateSubmitState(complete ? {} : null);

        if (complete && applyOptions.buildQuery !== false) {
            syncQuery();
        }

        return complete;
    }

    submitButton.addEventListener('click', () => {
        if (!feature || !area) {
            if (options.onError) {
                options.onError('Please choose both a feature and an area');
            }
            return;
        }

        // Always run what the fields say, not whatever the textarea holds
        const plan = syncQuery();

        if (plan && options.onSubmit) {
            options.onSubmit(plan);
        }
    });

    return {
        getState,
        applyState,
        featureCombobox,
        areaCombobox,

        /**
         * Whether both halves are committed, so the query can run
         * @returns {boolean} True when the Execute button should be enabled
         */
        isReady() {
            return Boolean(feature && area);
        }
    };
}
