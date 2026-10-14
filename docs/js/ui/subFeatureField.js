/**
 * subFeatureField.js
 * The Sub-feature field: a plain text input upgraded into a combobox with the
 * same tag lookup the feature field has - iD presets matched from plain words
 * ("parking space" offers amenity=parking_space) and the key/value rows
 * taginfo knows about - minus the curated features, which are whole searches
 * and not something to draw inside one.
 *
 * The input element stays the one the page was loaded with, because the
 * handlers that read and write the field looked it up by id when they were
 * imported. What this module adds is the list under it and the commits that
 * come out of it: a preset row or a completed tag value, or Enter, hands the
 * field's text to `onCommit` exactly as a blur would.
 */

import { createCombobox } from './combobox.js';
import { createFeatureSuggestions, rememberPickedCount } from './featureSuggestions.js';
import { canCommitTypedText } from '../search/selection.js';

/** Shown when nothing at all matches what was typed */
const NO_MATCH_MESSAGE = 'No matches - try another word, or a tag like amenity=parking_space';

/**
 * Upgrade a Sub-feature input into a combobox
 * @param {HTMLInputElement} input - The field, already in the page inside its root
 * @param {Object} options - Wiring
 * @param {Function} [options.onCommit] - (text) => void, the field has a new
 *     value chosen from the list or confirmed with Enter
 * @returns {Object} The combobox controller
 */
export function createSubFeatureField(input, options = {}) {
    const root = input.parentElement;

    const sources = createFeatureSuggestions({
        refresh: () => combobox.refresh(),
        tagsOnly: true
    });

    /**
     * Tell the caller the field holds something new
     */
    function commit() {
        if (options.onCommit) {
            options.onCommit(input.value);
        }
    }

    /**
     * Handle Enter. Tag text is taken as typed; a plain word takes the best
     * preset on offer, because "parking space" means amenity=parking_space
     * and not a key called parking space.
     * @param {string} text - The typed text
     */
    async function commitFromEnter(text) {
        if (!text.trim() || canCommitTypedText(text)) {
            commit();
            return;
        }

        await sources.waitForPresets();
        await combobox.refresh();

        // Only rows that stand for whole tags: a tag key row would leave
        // half a filter behind
        if (await combobox.pickBest(text, item => !item.splice)) {
            return;
        }

        combobox.showStatus(NO_MATCH_MESSAGE, 'empty');
    }

    const combobox = createCombobox(root, {
        input,
        getSuggestions: sources.getSuggestions,
        getEmptyMessage: (text, { committed }) => {
            if (committed || !text.trim()) {
                return null;
            }
            // Valid tag text with nothing to suggest is not a failure
            return canCommitTypedText(text) ? 'Press Enter to use these tags' : NO_MATCH_MESSAGE;
        },
        onEnterText: (text) => commitFromEnter(text),
        onPick: (item) => {
            rememberPickedCount(item.value);

            // A key is half a filter: the value is the next thing to choose
            if (item.value.kind === 'tagKey') {
                return;
            }
            commit();
        }
    });

    return combobox;
}
