/**
 * theme.js
 * Light and dark themes: which one is on, and applying it to the page
 */

const themeIconLight = document.getElementById('theme-icon-light');
const themeIconDark = document.getElementById('theme-icon-dark');

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
 * Apply theme to document and update icon
 * @param {string} theme - 'light' or 'dark'
 */
export function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);

    // Update icon visibility - show sun in dark mode (to switch to light), moon in light mode (to switch to dark)
    if (theme === 'dark') {
        themeIconLight.classList.remove('hidden');
        themeIconDark.classList.add('hidden');
    } else {
        themeIconLight.classList.add('hidden');
        themeIconDark.classList.remove('hidden');
    }
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
