/**
 * selection.js
 * What a committed "X of Y" selection is, with no DOM and no combobox: which
 * typed text may stand for a feature, how a feature or an area is built from a
 * curated key, a preset or a place, which areas a feature allows, and how the
 * pair converts to and from the flat state shape that share links and storage
 * use.
 *
 * Pure logic, so every rule here is testable in Node. The search tab keeps the
 * parts that need the page: the input fields, the suggestion lists, and
 * verifying a label against the presets.
 */

import { FEATURES, AREAS, getValidAreasForFeature, isKnownArea } from '../config/features.js';
import { DEFAULT_ELEMENT_TYPES } from './queryBuilder.js';
import {
    parseTagExpression,
    normaliseTagExpression,
    stringifyFilters,
    classifyInput
} from './tagParser.js';
import { presetToFilters } from './presets.js';
import { normaliseAreaRef, SHAREABLE_ELEMENT_TYPES } from '../utils/sharing.js';

/** Where the last committed selection is remembered */
export const STORAGE_KEY = 'xofy-osm-search-selection';

/**
 * Case-insensitive "contains", with whitespace collapsed
 * @param {string} haystack - Text to search in
 * @param {string} needle - Text to look for
 * @returns {boolean} True when it matches
 */
export function matchesText(haystack, needle) {
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
 * A free-form feature from tags the user typed
 * @param {string} text - The typed expression
 * @returns {Object|null} A feature selection, or null when the text is not
 *     unmistakably tags
 */
export function typedFeature(text) {
    if (!canCommitTypedText(text)) {
        return null;
    }

    const { filters } = parseTagExpression(text);

    return {
        kind: 'free',
        filters,
        expression: stringifyFilters(filters),
        label: '',
        elementTypes: DEFAULT_ELEMENT_TYPES
    };
}

/**
 * A free-form feature from a preset the user picked. Its name is trusted here:
 * it came from the preset file rather than from a link.
 * @param {Object} preset - A preset record from search/presets.js
 * @returns {Object} A feature selection
 */
export function presetFeature(preset) {
    const filters = presetToFilters(preset);

    return {
        kind: 'free',
        filters,
        expression: stringifyFilters(filters),
        label: preset.name,
        elementTypes: preset.elementTypes || DEFAULT_ELEMENT_TYPES
    };
}

/**
 * A feature from the curated list
 * @param {string} key - Key from FEATURES
 * @returns {Object} A feature selection
 */
export function curatedFeature(key) {
    return { kind: 'curated', key };
}

/**
 * An area from the curated list
 * @param {string} key - Key from AREAS
 * @returns {Object} An area selection
 */
export function curatedArea(key) {
    return { kind: 'curated', key };
}

/**
 * An area from a place search
 * @param {{osmType: string, osmId: number}} ref - The area reference
 * @param {string} label - The name to show for it
 * @returns {Object} An area selection
 */
export function placeArea(ref, label) {
    return { kind: 'place', ref, label };
}

/**
 * The text the feature field shows for a committed feature. A free-form
 * feature falls back to its tags, because a label is only shown once it has
 * been checked against the presets.
 * @param {Object} feature - A feature selection
 * @returns {string} The text to show
 */
export function featureLabel(feature) {
    if (feature.kind === 'curated') {
        return FEATURES[feature.key].displayName;
    }
    return feature.label || feature.expression;
}

/**
 * The text the area field shows for a committed area
 * @param {Object} area - An area selection
 * @returns {string} The text to show
 */
export function areaLabel(area) {
    if (area.kind === 'curated') {
        return AREAS[area.key].displayName;
    }
    return area.label;
}

/**
 * Whether an area may be searched for a feature. Only curated features have
 * rules: a free-form one carries no admin level and no allowed list.
 * @param {Object|null} feature - The committed feature
 * @param {Object|null} area - The committed area
 * @returns {boolean} True when the pair is allowed
 */
export function areaAllowedFor(feature, area) {
    if (!area || !feature || feature.kind !== 'curated') {
        return true;
    }

    if (area.kind === 'curated') {
        return getValidAreasForFeature(feature.key).some(([key]) => key === area.key);
    }

    // A feature pinned to particular curated areas (subway networks, theme
    // park rides) cannot be pointed at an arbitrary searched place
    return !FEATURES[feature.key].allowedAreas;
}

/**
 * The committed selection, in the flat shape utils/sharing.js expects
 * @param {Object|null} feature - The committed feature
 * @param {Object|null} area - The committed area
 * @returns {Object} {feature, x, xLabel, xElementTypes, area, y, yLabel}
 */
export function selectionToState(feature, area) {
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
 * Read a selection that came from a URL or from storage. Everything here is
 * outside input, so each half is checked rather than trusted, and anything
 * that does not check out is simply left unset.
 * @param {Object|null} state - {feature, x, xLabel, xElementTypes, area, y, yLabel}
 * @returns {{feature: Object|null, area: Object|null, pendingLabel: string}}
 *     The selection, plus the label still to be verified against the presets
 */
export function selectionFromState(state) {
    if (!state) {
        return { feature: null, area: null, pendingLabel: '' };
    }

    let feature = null;
    let pendingLabel = '';

    if (state.feature && FEATURES[state.feature]) {
        feature = curatedFeature(state.feature);
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
        pendingLabel = state.xLabel || '';
    }

    let area = null;

    if (state.area && isKnownArea(state.area)) {
        area = curatedArea(state.area);
    } else if (state.y) {
        // Storage and share links are outside input: check the reference
        const ref = normaliseAreaRef(state.y);

        if (ref) {
            area = placeArea(ref, state.yLabel || `${ref.osmType} ${ref.osmId}`);
        }
    }

    return { feature, area, pendingLabel };
}

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
 * Remember the committed selection. An empty one is removed rather than
 * stored, so a cleared field does not come back on the next visit.
 * @param {Object} state - The shape selectionToState() returns
 */
export function storeSelection(state) {
    try {
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
