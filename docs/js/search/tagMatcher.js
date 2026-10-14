/**
 * tagMatcher.js
 * Tests a tag list against the filters tagParser produces, the way Overpass
 * would: every filter has to hold for the element to match.
 *
 * Used to sort a result set into main features and sub-features after it has
 * been fetched, because a single query brings both back and nothing in the
 * response says which selector each element came from.
 *
 * Pure logic: no DOM and no network, so it can be imported in Node for tests.
 */

/**
 * Compile a regex filter's pattern once, failing safe
 * @param {string} pattern - The regex text as typed
 * @returns {RegExp|null} The pattern, or null when it is not a valid regex
 */
function compilePattern(pattern) {
    try {
        return new RegExp(String(pattern ?? ''));
    } catch (error) {
        return null;
    }
}

/**
 * Whether one filter holds for a tag list
 * @param {Object} tags - OSM tags
 * @param {Object} filter - Filter from tagParser ({key, op, value})
 * @returns {boolean} True when the tags satisfy the filter
 */
export function matchesFilter(tags, filter) {
    if (!filter || !filter.key) {
        return false;
    }

    const value = tags && Object.prototype.hasOwnProperty.call(tags, filter.key)
        ? String(tags[filter.key])
        : null;

    switch (filter.op) {
        case 'exists':
            return value !== null;
        case 'missing':
            return value === null;
        case '=':
            return value !== null && value === String(filter.value ?? '');
        case '!=':
            // Overpass [k!=v] also matches elements without k at all
            return value === null || value !== String(filter.value ?? '');
        case '~': {
            const pattern = compilePattern(filter.value);
            return value !== null && pattern !== null && pattern.test(value);
        }
        case '!~': {
            const pattern = compilePattern(filter.value);
            // No k, no match - but [k!~v] on an element without k is true
            return value === null || (pattern !== null && !pattern.test(value));
        }
        default:
            return false;
    }
}

/**
 * Whether every filter holds for a tag list
 * @param {Object} tags - OSM tags
 * @param {Array<Object>} filters - Filters from tagParser
 * @returns {boolean} True when the tags satisfy all of them; false for an
 *     empty filter list, which describes nothing
 */
export function matchesFilters(tags, filters) {
    if (!Array.isArray(filters) || filters.length === 0) {
        return false;
    }
    return filters.every(filter => matchesFilter(tags || {}, filter));
}
