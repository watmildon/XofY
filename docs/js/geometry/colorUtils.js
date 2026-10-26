/**
 * colorUtils.js
 * Validates OSM colour tags and normalises them to hex
 */

/**
 * Canvas element for color validation (created once, reused)
 */
let colorValidationCanvas = null;
let colorValidationCtx = null;

/**
 * OSM keys that give a feature's colour, most authoritative first. The first
 * one a feature carries is its colour; later keys are not consulted, so a
 * value that is not a colour (colour=multi) leaves the feature uncoloured.
 */
export const COLOUR_KEYS = [
    'colour',
    'surface:colour',
    'roof:colour',
    'building:roof:colour',
    'building:colour'
];

/**
 * The raw colour tag value a feature is drawn with
 * @param {Object} tags - OSM tags
 * @returns {string|undefined} Value of the first COLOUR_KEYS key present
 */
export function colourTagValue(tags) {
    if (!tags) return undefined;
    const key = COLOUR_KEYS.find(k => tags[k] !== undefined && tags[k] !== null);
    return key ? tags[key] : undefined;
}

/**
 * A feature's OSM colour as hex
 * @param {Object} tags - OSM tags
 * @returns {string|null} Hex color string or null if untagged or invalid
 */
export function colourFromTags(tags) {
    return validateAndConvertColor(colourTagValue(tags));
}

/**
 * Validate and convert OSM colour tag to hex format
 * Handles hex colors (#FF0000) and named colors (red, blue, etc.)
 * @param {string} colorValue - The colour tag value from OSM
 * @returns {string|null} Hex color string or null if invalid
 */
export function validateAndConvertColor(colorValue) {
    if (!colorValue || typeof colorValue !== 'string') {
        return null;
    }

    let trimmed = colorValue.trim();

    // Already a hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
        return trimmed.toUpperCase();
    }

    // OSM writes CSS names with separators (light_gray, dark green, dark-red);
    // CSS wants them run together
    if (/^[a-z]+(?:[\s_-]+[a-z]+)+$/i.test(trimmed)) {
        trimmed = trimmed.replace(/[\s_-]+/g, '');
    }

    // Try to convert named color or other format using Canvas API
    if (!colorValidationCanvas) {
        colorValidationCanvas = document.createElement('canvas');
        colorValidationCanvas.width = 1;
        colorValidationCanvas.height = 1;
        colorValidationCtx = colorValidationCanvas.getContext('2d');
    }

    // Set the color and read it back - browser will normalize it
    colorValidationCtx.fillStyle = '#000000'; // Reset to known value
    colorValidationCtx.fillStyle = trimmed;

    const result = colorValidationCtx.fillStyle;

    // If it didn't change from black, the color was invalid
    if (result === '#000000' && trimmed.toLowerCase() !== 'black' && trimmed !== '#000000') {
        return null;
    }

    // Convert rgb(r, g, b) to hex
    if (result.startsWith('rgb')) {
        const matches = result.match(/\d+/g);
        if (matches && matches.length >= 3) {
            const r = parseInt(matches[0]).toString(16).padStart(2, '0');
            const g = parseInt(matches[1]).toString(16).padStart(2, '0');
            const b = parseInt(matches[2]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`.toUpperCase();
        }
    }

    // Already in hex format from browser
    if (result.startsWith('#')) {
        return result.toUpperCase();
    }

    return null;
}
