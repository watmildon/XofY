/**
 * areaSuggestions.js
 * What the area field offers: the curated areas that suit the feature already
 * chosen, an action row for searching anywhere else, and the places Nominatim
 * finds when that row or Enter asks for them.
 *
 * A factory, because the curated list depends on the committed feature, which
 * lives in the search tab; `getFeature` reads it when the list is built rather
 * than capturing it once. The geocoder is only ever asked on purpose - typing
 * a place name suggests nothing by itself.
 */

import { AREAS, getValidAreasForFeature } from '../config/features.js';
import { searchPlaces } from '../search/nominatim.js';
import { matchesText, curatedArea } from '../search/selection.js';
import { SINGLE_GROUP_ROWS } from './combobox.js';

/**
 * Build the area field's suggestion sources
 * @param {Object} options - Wiring
 * @param {Function} options.getFeature - () => the committed feature, or null
 * @returns {Object} {getSuggestions, getActionRow, findExactArea, searchPlaces}
 */
export function createAreaSuggestions({ getFeature }) {
    /**
     * Curated areas that are valid for the chosen feature and match the text
     * @param {string} text - Typed text
     * @returns {Array<Object>} Suggestion items
     */
    function curatedAreaItems(text) {
        const feature = getFeature();
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
     * Ask Nominatim about the typed place name and show the answers
     * @param {Object} combobox - The area combobox to show them in
     * @param {string} query - The place name
     */
    async function runPlaceSearch(combobox, query) {
        if (!query || !query.trim()) {
            return;
        }

        // Anything the user does next makes this answer stale
        const token = combobox.beginRequest();
        combobox.showStatus('Searching for places...', 'info', token);

        try {
            const { places, total } = await searchPlaces(query);

            if (places.length > 0) {
                combobox.presentGroups([{ label: 'Places', items: places.map(placeItem) }], null, token);
                return;
            }

            combobox.showStatus(
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
            combobox.showStatus(
                error && error.status === 429
                    ? 'Too many place searches - wait a moment and try again'
                    : 'Place search failed, please try again',
                'error',
                token
            );
        }
    }

    return {
        /**
         * The suggestion groups for the area field
         * @param {string} text - Typed text
         * @param {Object} context - {committed}
         * @returns {Array<Object>} Groups
         */
        getSuggestions(text, { committed }) {
            // One group, so the whole list of areas is offered
            return [
                { label: 'Curated', items: curatedAreaItems(committed ? '' : text).slice(0, SINGLE_GROUP_ROWS) }
            ];
        },

        /**
         * The "Search for ..." row, which is how the geocoder gets asked
         * @param {string} text - Typed text
         * @param {Object} context - {committed}
         * @returns {Object|null} The row, or null when there is nothing to search for
         */
        getActionRow(text, { committed }) {
            return !committed && text && text.trim()
                ? {
                    kind: 'action',
                    primary: `Search for "${text.trim()}"`,
                    text,
                    value: { kind: 'search', query: text }
                }
                : null;
        },

        /**
         * The curated area whose name is exactly the typed text, if there is
         * one. The whole of AREAS is searched, not just the areas the chosen
         * feature allows: typing an area's name in full and clicking away has
         * always committed it, and only a change of feature re-checks the pair.
         * @param {string} text - The typed text
         * @returns {Object|null} An area selection, or null
         */
        findExactArea(text) {
            const wanted = String(text ?? '').trim().toLowerCase();
            const match = wanted && Object.entries(AREAS)
                .find(([, entry]) => entry.displayName.toLowerCase() === wanted);

            return match ? curatedArea(match[0]) : null;
        },

        searchPlaces: runPlaceSearch
    };
}
