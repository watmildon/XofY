/**
 * featureSuggestions.js
 * What the feature field offers while you type: the curated features, the iD
 * presets matched from plain words, and the key/value rows taginfo knows about.
 *
 * A factory rather than plain functions, because two of the three sources
 * answer late. The preset file and the taginfo lookups are started in the
 * background and never awaited by the list itself, so a slow or dead service
 * can never hold up typing; when an answer lands, `refresh` is called and the
 * combobox asks again.
 */

import { FEATURES } from '../config/features.js';
import { classifyInput, getTypingContext, quoteValue } from '../search/tagParser.js';
import {
    loadPresets,
    peekPresets,
    matchPresets,
    presetTagSummary
} from '../search/presets.js';
import { peekSuggestions, requestSuggestions, formatCount } from '../search/taginfo.js';
import { matchesText, curatedFeature, presetFeature } from '../search/selection.js';
import { SINGLE_GROUP_ROWS } from './combobox.js';

/**
 * Rows per suggestion group when more than one group can match (a curated
 * feature, presets and tag keys), so that every group stays reachable without
 * a long scroll.
 */
const MAX_GROUP_ROWS = 6;

/** How long Enter waits for the feature list before deciding without it */
const PRESET_WAIT_MS = 1500;

/**
 * Build the feature field's suggestion sources
 * @param {Object} options - Wiring
 * @param {Function} options.refresh - () => void, called when a late answer
 *     arrives and the list should be asked again
 * @returns {Object} {getSuggestions, waitForPresets, findExactFeature, isKnownTagKey}
 */
export function createFeatureSuggestions({ refresh }) {
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
                refresh();
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
                    refresh();
                }
            });
            return [];
        }

        // The count beside each row is the same number the Postpass planner
        // would go and ask taginfo for, so picking a row hands it over rather
        // than causing a second lookup of what is already on the screen
        return rows.map(row => (context.field === 'value'
            ? {
                primary: `${row.key}=${row.value}`,
                meta: formatCount(row.count),
                value: {
                    kind: 'tagValue',
                    filter: { key: row.key, op: '=', value: row.value },
                    count: row.count
                },
                splice: { start: context.start, end: context.end, text: quoteValue(row.value) }
            }
            : {
                primary: `${row.key}=`,
                meta: formatCount(row.count),
                value: {
                    kind: 'tagKey',
                    filter: { key: row.key, op: 'exists' },
                    count: row.count
                },
                // Leave the list open: the value is the next thing to choose
                splice: { start: context.start, end: context.end, text: `${row.key}=`, keepOpen: true }
            }));
    }

    return {
        /**
         * All the suggestion groups for the feature field
         * @param {string} text - Typed text
         * @param {Object} context - {committed, caret}
         * @returns {Array<Object>} Groups
         */
        getSuggestions(text, { committed, caret }) {
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
        },

        waitForPresets,

        /**
         * The feature whose name is exactly the typed text, if there is one.
         * Used when focus leaves the field: someone who typed a name in full
         * and clicked away meant that feature.
         * @param {string} text - The typed text
         * @returns {Object|null} A feature selection, or null
         */
        findExactFeature(text) {
            const wanted = String(text ?? '').trim().toLowerCase();

            if (!wanted) {
                return null;
            }

            const curated = Object.entries(FEATURES)
                .find(([, entry]) => entry.displayName.toLowerCase() === wanted);

            if (curated) {
                return curatedFeature(curated[0]);
            }

            const presets = peekPresets();
            // Ranked, so the first of any duplicate names is the most used one
            const match = presets && matchPresets(presets, wanted, { limit: MAX_GROUP_ROWS })
                .find(preset => preset.name.toLowerCase() === wanted);

            return match ? presetFeature(match) : null;
        },

        /**
         * Whether taginfo has confirmed this exact key exists
         * @param {string} text - The typed text
         * @returns {boolean} True when the key is a real one
         */
        isKnownTagKey(text) {
            const wanted = String(text ?? '').trim();
            const rows = peekSuggestions(getTypingContext(wanted)) || [];
            return rows.some(row => row.key === wanted && row.value === undefined);
        }
    };
}
