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
 * Validate and convert OSM colour tag to hex format
 * Handles hex colors (#FF0000) and named colors (red, blue, etc.)
 * @param {string} colorValue - The colour tag value from OSM
 * @returns {string|null} Hex color string or null if invalid
 */
export function validateAndConvertColor(colorValue) {
    if (!colorValue || typeof colorValue !== 'string') {
        return null;
    }

    const trimmed = colorValue.trim();

    // Already a hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
        return trimmed.toUpperCase();
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
