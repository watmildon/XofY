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
 * Anything that is not a curated feature in a curated area gets its size
 * checked with `out count;` before it runs - see the plan handed to onSubmit.
 */

import { FEATURES, AREAS, getValidAreasForFeature, isKnownArea } from '../config/features.js';
import { buildQueryPlan } from '../search/queryPlan.js';
import { DEFAULT_ELEMENT_TYPES } from '../search/queryBuilder.js';
import {
    parseTagExpression,
    normaliseTagExpression,
    stringifyFilters,
    classifyInput,
    getTypingContext,
    quoteValue
} from '../search/tagParser.js';
import {
    loadPresets,
    peekPresets,
    matchPresets,
    presetToFilters,
    presetTagSummary
} from '../search/presets.js';
import { peekSuggestions, requestSuggestions, formatCount } from '../search/taginfo.js';
import { searchPlaces } from '../search/nominatim.js';
import { normaliseAreaRef, SHAREABLE_ELEMENT_TYPES } from '../utils/sharing.js';
import { createCombobox } from './combobox.js';

/** Where the last committed selection is remembered */
const STORAGE_KEY = 'xofy-osm-search-selection';

/**
 * Rows per suggestion group when more than one group can match (a curated
 * feature, presets and tag keys), so that every group stays reachable without
 * a long scroll.
 */
const MAX_GROUP_ROWS = 6;

/**
 * Rows when only one group can match. Then there is nothing to make room for,
 * so the whole list is offered - all 18 curated features, all 30 areas - and
 * the list scrolls if it must.
 */
const SINGLE_GROUP_ROWS = 50;

/** Shown when nothing at all matches what was typed */
const NO_MATCH_MESSAGE = 'No matches - try another word, or a tag like leisure=park';

/** How long Enter waits for the feature list before deciding without it */
const PRESET_WAIT_MS = 1500;

/**
 * Read the last committed selection
 * @returns {Object|null} {feature, x, xLabel, xElementTypes, area, y, yLabel} or null
 */
export function loadStoredSelection() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
        console.warn('Failed to read the saved selection:', e);
        return null;
    }
}

/**
 * Case-insensitive "contains", with whitespace collapsed
 * @param {string} haystack - Text to search in
 * @param {string} needle - Text to look for
 * @returns {boolean} True when it matches
 */
function matchesText(haystack, needle) {
    if (!needle) {
        return true;
    }
    return String(haystack).toLowerCase().includes(needle.trim().replace(/\s+/g, ' ').toLowerCase());
}

/**
 * Whether a parsed expression is complete enough to search for. A filter still
 * being typed (`leisure=`) has a key but no value yet.
 * @param {Array<Object>} filters - Filters from tagParser
 * @returns {boolean} True when the filters can be queried
 */
export function isCommittableExpression(filters) {
    return Array.isArray(filters) && filters.length > 0 && filters.every(filter => (
        filter.op === 'exists' || filter.op === 'missing' || (filter.value !== undefined && filter.value !== '')
    ));
}

/**
 * Whether typed text is unmistakably tags, and so can be committed without the
 * user picking anything. Plain words are the feature list's job: "swimming
 * pool" parses as two key-exists filters and "lighthouse" as one, which is
 * never what either means. Written with an operator - `lighthouse=*`,
 * `leisure=park name`, `!athletics` - the intent is clear.
 * @param {string} text - The typed text
 * @returns {boolean} True when the text can be committed as tags
 */
export function canCommitTypedText(text) {
    if (classifyInput(text) === 'words') {
        return false;
    }

    const { filters } = parseTagExpression(text);

    if (!isCommittableExpression(filters)) {
        return false;
    }

    // A lone bare word is a word. Inside a longer expression a bare key is
    // unambiguous, because the rest of the expression says it is tags.
    return filters.length > 1 || !isBareWord(text);
}

/**
 * Whether the text is a single word with no tag syntax at all
 * @param {string} text - The typed text
 * @returns {boolean} True for something like `lighthouse`
 */
function isBareWord(text) {
    return !/[=!~*]/.test(String(text ?? ''));
}

/**
 * Whether Enter on this text, with nothing to pick, should search for the key
 * existing. Only a word that could be an OSM key qualifies.
 * @param {string} text - The typed text
 * @returns {boolean} True when it can stand for `key=*`
 */
export function canCommitAsKeyExists(text) {
    if (classifyInput(text) === 'words') {
        return false;
    }

    const { filters } = parseTagExpression(text);
    return filters.length === 1 && filters[0].op === 'exists';
}

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
    // The preset load failure already reported, so it is not repeated
    let reportedPresetError = null;

    /**
     * Curated features whose name matches the typed text
     * @param {string} text - Typed text
     * @returns {Array<Object>} Suggestion items
     */
    function curatedFeatureItems(text) {
        return Object.entries(FEATURES)
            .filter(([, entry]) => matchesText(entry.displayName, text))
            .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName))
            .map(([key, entry]) => ({
                primary: entry.displayName,
                text: entry.displayName,
                value: { kind: 'curated', key }
            }));
    }

    /**
     * Features matching plain words, with how much their tags are used. Like
     * the tag rows, these appear as soon as the file is here: the list is never
     * held up waiting for it, so a stalled fetch cannot block typing or Enter.
     * @param {string} text - Typed text
     * @param {number} limit - How many to offer
     * @returns {Array<Object>} Suggestion items
     */
    function presetItems(text, limit) {
        const presets = peekPresets();

        if (!presets) {
            requestPresets();
            return [];
        }

        return matchPresets(presets, text, { limit }).map(preset => ({
            primary: preset.name,
            secondary: presetTagSummary(preset),
            meta: (preset.approx ? '~' : '') + formatCount(preset.count),
            text: preset.name,
            value: { kind: 'preset', preset }
        }));
    }

    /**
     * Start the preset load, and refresh the list once it lands
     * @returns {Promise<void>} Resolves when there is nothing more to wait for
     */
    function requestPresets() {
        return loadPresets()
            .then(() => {
                featureCombobox.refresh();
            })
            .catch(error => {
                // The loader backs off after a failure and rejects with the
                // same error meanwhile, so this is said once per failure
                if (error !== reportedPresetError) {
                    reportedPresetError = error;
                    console.warn('Could not load the feature list:', error);
                }
            });
    }

    /**
     * Wait a little for the feature list, then carry on regardless
     * @returns {Promise<void>} Resolves when the presets are here or time is up
     */
    function waitForPresets() {
        if (peekPresets()) {
            return Promise.resolve();
        }
        return Promise.race([
            requestPresets(),
            new Promise(resolve => setTimeout(resolve, PRESET_WAIT_MS))
        ]);
    }

    /**
     * Key or value suggestions for the tag fragment under the caret. taginfo is
     * asked in the background; until it answers there is simply no Tags group.
     * @param {string} text - Typed text
     * @param {number} [caret] - Caret offset, so an edit in the middle of the
     *     expression completes the fragment being edited rather than the last one
     * @returns {Array<Object>} Suggestion items
     */
    function tagItems(text, caret) {
        const context = getTypingContext(text, caret);
        const rows = peekSuggestions(context);

        if (rows === undefined) {
            requestSuggestions(context).then(items => {
                if (items.length > 0) {
                    featureCombobox.refresh();
                }
            });
            return [];
        }

        return rows.map(row => (context.field === 'value'
            ? {
                primary: `${row.key}=${row.value}`,
                meta: formatCount(row.count),
                value: { kind: 'tagValue' },
                splice: { start: context.start, end: context.end, text: quoteValue(row.value) }
            }
            : {
                primary: `${row.key}=`,
                meta: formatCount(row.count),
                value: { kind: 'tagKey' },
                // Leave the list open: the value is the next thing to choose
                splice: { start: context.start, end: context.end, text: `${row.key}=`, keepOpen: true }
            }));
    }

    /**
     * All the suggestion groups for the feature field
     * @param {string} text - Typed text
     * @param {Object} context - {committed}
     * @returns {Promise<Array<Object>>} Groups
     */
    function featureSuggestions(text, { committed, caret }) {
        const query = committed ? '' : text;
        const curated = curatedFeatureItems(query);

        if (!query.trim()) {
            // Warm the feature file on first focus without holding up the list
            if (!peekPresets()) {
                requestPresets();
            }
            return [{ label: 'Curated', items: curated.slice(0, SINGLE_GROUP_ROWS) }];
        }

        const kind = classifyInput(query);
        const wantsPresets = kind !== 'tag';
        const wantsTags = kind !== 'words';

        // The cap is decided by which groups *can* appear, not by which have
        // arrived: taginfo answers later, and rows above it must not move
        const expectedGroups = (curated.length > 0 ? 1 : 0) + (wantsPresets ? 1 : 0) + (wantsTags ? 1 : 0);
        const limit = expectedGroups > 1 ? MAX_GROUP_ROWS : SINGLE_GROUP_ROWS;

        const presets = wantsPresets ? presetItems(query, limit) : [];
        const tags = wantsTags ? tagItems(query, caret) : [];

        return [
            { label: 'Curated', items: curated },
            { label: 'Features', items: presets },
            { label: 'Tags', items: tags }
        ]
            .filter(group => group.items.length > 0)
            .map(group => ({ ...group, items: group.items.slice(0, limit) }));
    }

    /**
     * Curated areas that are valid for the chosen feature and match the text
     * @param {string} text - Typed text
     * @returns {Array<Object>} Suggestion items
     */
    function curatedAreaItems(text) {
        // A free-form feature has no admin level rules, so it may use any area
        const entries = feature && feature.kind === 'curated'
            ? getValidAreasForFeature(feature.key)
            : Object.entries(AREAS);

        return entries
            .filter(([, value]) => matchesText(value.displayName, text))
            .sort((a, b) => a[1].adminLevel - b[1].adminLevel || a[1].displayName.localeCompare(b[1].displayName))
            .map(([key, value]) => ({
                primary: value.displayName,
                text: value.displayName,
                value: { kind: 'curated', key }
            }));
    }

    /**
     * Commit the curated area whose name is exactly the typed text
     * @param {string} text - The typed text
     * @returns {boolean} True when something was committed
     */
    function commitExactAreaName(text) {
        const wanted = String(text ?? '').trim().toLowerCase();
        const match = wanted && Object.entries(AREAS)
            .find(([, entry]) => entry.displayName.toLowerCase() === wanted);

        if (!match) {
            return false;
        }

        area = { kind: 'curated', key: match[0] };
        areaCombobox.setValue(match[1].displayName, { value: area });
        syncQuery();
        persist();
        return true;
    }

    /**
     * Turn a geocoder result into a suggestion row
     * @param {Object} place - A place from nominatim.js
     * @returns {Object} Suggestion item
     */
    function placeItem(place) {
        return {
            primary: place.label,
            meta: place.hint,
            text: place.label,
            value: {
                kind: 'place',
                ref: { osmType: place.osmType, osmId: place.osmId },
                label: place.label
            }
        };
    }

    /**
     * Remember the committed selection
     */
    function persist() {
        try {
            const state = getState();
            const empty = !state.feature && !state.x && !state.area && !state.y;

            if (empty) {
                localStorage.removeItem(STORAGE_KEY);
            } else {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            }
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
        if (!area || !feature || feature.kind !== 'curated') {
            return;
        }

        if (area.kind === 'curated') {
            const stillValid = getValidAreasForFeature(feature.key).some(([key]) => key === area.key);
            if (!stillValid) {
                clearArea();
            }
            return;
        }

        // A feature pinned to particular curated areas (subway networks, theme
        // park rides) cannot be pointed at an arbitrary searched place
        if (FEATURES[feature.key].allowedAreas) {
            clearArea();
        }
    }

    /**
     * Commit tags the user typed, if they are unmistakably tags
     * @param {string} text - The typed expression
     * @returns {boolean} True when it was committed
     */
    function commitTypedTags(text) {
        if (!canCommitTypedText(text)) {
            return false;
        }

        const { filters } = parseTagExpression(text);

        feature = {
            kind: 'free',
            filters,
            expression: stringifyFilters(filters),
            label: '',
            elementTypes: DEFAULT_ELEMENT_TYPES
        };
        revalidateArea();
        syncQuery();
        persist();
        return true;
    }

    /**
     * Adopt a feature from the preset list
     * @param {Object} preset - A preset record
     */
    function setPresetFeature(preset) {
        const filters = presetToFilters(preset);

        feature = {
            kind: 'free',
            filters,
            expression: stringifyFilters(filters),
            label: preset.name,
            elementTypes: preset.elementTypes || DEFAULT_ELEMENT_TYPES
        };
    }

    /**
     * Commit the feature whose name is exactly the typed text, if there is one.
     * Used when focus leaves the field: someone who typed a name in full and
     * clicked away meant that feature.
     * @param {string} text - The typed text
     * @returns {boolean} True when something was committed
     */
    function commitExactFeatureName(text) {
        const wanted = String(text ?? '').trim().toLowerCase();

        if (!wanted) {
            return false;
        }

        const curated = Object.entries(FEATURES)
            .find(([, entry]) => entry.displayName.toLowerCase() === wanted);

        if (curated) {
            feature = { kind: 'curated', key: curated[0] };
        } else {
            const presets = peekPresets();
            // Ranked, so the first of any duplicate names is the most used one
            const match = presets && matchPresets(presets, wanted, { limit: MAX_GROUP_ROWS })
                .find(preset => preset.name.toLowerCase() === wanted);

            if (!match) {
                return false;
            }
            setPresetFeature(match);
        }

        featureCombobox.setValue(feature.kind === 'curated'
            ? FEATURES[feature.key].displayName
            : feature.label, { value: feature });
        revalidateArea();
        syncQuery();
        persist();
        return true;
    }

    /**
     * Whether taginfo has confirmed this exact key exists
     * @param {string} text - The typed text
     * @returns {boolean} True when the key is a real one
     */
    function isKnownTagKey(text) {
        const wanted = String(text ?? '').trim();
        const rows = peekSuggestions(getTypingContext(wanted)) || [];
        return rows.some(row => row.key === wanted && row.value === undefined);
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
        await waitForPresets();
        await featureCombobox.refresh();

        // Only rows that stand for a whole feature: a tag key row would leave
        // half a filter behind
        if (await featureCombobox.pickBest(text, item => !item.splice)) {
            return;
        }

        // Nothing matched. A word taginfo knows as a key becomes a key search;
        // a misspelling gets told so rather than searching for nothing.
        if (canCommitAsKeyExists(text) && isKnownTagKey(text)) {
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
    async function runPlaceSearch(query) {
        if (!query || !query.trim()) {
            return;
        }

        // Anything the user does next makes this answer stale
        const token = areaCombobox.beginRequest();
        areaCombobox.showStatus('Searching for places...', 'info', token);

        try {
            const { places, total } = await searchPlaces(query);

            if (places.length > 0) {
                areaCombobox.presentGroups([{ label: 'Places', items: places.map(placeItem) }], null, token);
                return;
            }

            areaCombobox.showStatus(
                total > 0
                    // Points and streets both come back with nothing to search
                    ? 'Nothing there has an area to search - try a town, district or park'
                    : 'No places found',
                'empty',
                token
            );
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return;
            }
            console.warn('Place search failed:', error);
            areaCombobox.showStatus(
                error && error.status === 429
                    ? 'Too many place searches - wait a moment and try again'
                    : 'Place search failed, please try again',
                'error',
                token
            );
        }
    }

    const featureCombobox = createCombobox(featureRoot, {
        inputId: 'feature-input',
        placeholder: 'Swimming pools, leisure=park...',
        getSuggestions: featureSuggestions,
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
                setPresetFeature(item.value.preset);
            } else {
                feature = { kind: 'curated', key: item.value.key };
            }

            revalidateArea();
            syncQuery();
            persist();
        }
    });

    const areaCombobox = createCombobox(areaRoot, {
        inputId: 'area-input',
        placeholder: 'Seattle, Nice, France...',
        // One group, so the whole list of areas is offered
        getSuggestions: (text, { committed }) => [
            { label: 'Curated', items: curatedAreaItems(committed ? '' : text).slice(0, SINGLE_GROUP_ROWS) }
        ],
        getActionRow: (text, { committed }) => (!committed && text && text.trim()
            ? {
                kind: 'action',
                primary: `Search for "${text.trim()}"`,
                text,
                value: { kind: 'search', query: text }
            }
            : null),
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
        const free = feature && feature.kind === 'free' ? feature : null;
        const place = area && area.kind === 'place' ? area : null;

        return {
            feature: feature && feature.kind === 'curated' ? feature.key : '',
            x: free ? free.expression : '',
            xLabel: free ? free.label : '',
            xElementTypes: free ? free.elementTypes : '',
            area: area && area.kind === 'curated' ? area.key : '',
            y: place ? place.ref : null,
            yLabel: place ? place.label : ''
        };
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

        if (state.feature && FEATURES[state.feature]) {
            feature = { kind: 'curated', key: state.feature };
            featureCombobox.setValue(FEATURES[state.feature].displayName, { value: feature });
        // A link or a stored value is not someone typing, so a bare key there
        // is unambiguous; it is shown canonically as `key=*`
        } else if (state.x && (canCommitTypedText(state.x) || canCommitAsKeyExists(state.x))) {
            feature = {
                kind: 'free',
                filters: parseTagExpression(state.x).filters,
                expression: normaliseTagExpression(state.x),
                // A label from a link is a claim about the tags until checked
                label: '',
                elementTypes: SHAREABLE_ELEMENT_TYPES.includes(state.xElementTypes)
                    ? state.xElementTypes
                    : DEFAULT_ELEMENT_TYPES
            };
            featureCombobox.setValue(feature.expression, { value: feature });

            if (state.xLabel) {
                verifyLabel(feature, state.xLabel);
            }
        }

        if (state.area && isKnownArea(state.area)) {
            area = { kind: 'curated', key: state.area };
            areaCombobox.setValue(AREAS[state.area].displayName, { value: area });
        } else if (state.y) {
            // Storage and share links are outside input: check the reference
            const ref = normaliseAreaRef(state.y);

            if (ref) {
                const label = state.yLabel || `${ref.osmType} ${ref.osmId}`;
                area = { kind: 'place', ref, label };
                areaCombobox.setValue(label, { value: area });
            }
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
