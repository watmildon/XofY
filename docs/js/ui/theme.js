/**
 * theme.js
 * Light and dark themes: which one is on, and applying it to the page
 */

// The theme in effect ('light' or 'dark'), set by applyTheme()
let currentTheme = null;

/**
 * Get effective theme based on system preference
 * @returns {string} 'light' or 'dark'
 */
export function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply theme to the document. The palette and the toggle's sun/moon icons
 * both follow the data-theme attribute in CSS.
 * @param {string} theme - 'light' or 'dark'
 */
export function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
}

/**
 * The theme currently applied
 * @returns {string|null} 'light', 'dark', or null before applyTheme() has run
 */
export function getTheme() {
    return currentTheme;
}

/**
 * Switch between light and dark
 * @returns {string} The theme now applied
 */
export function toggleTheme() {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    return currentTheme;
}
