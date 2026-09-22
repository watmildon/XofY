/**
 * displayPanel.js
 * The collapsible Display Options panel
 */

const displayPanel = document.querySelector('.display-panel');
const displayPanelToggle = document.getElementById('display-panel-toggle');

/**
 * Toggle display panel expand/collapse
 */
export function toggleDisplayPanel() {
    displayPanel.classList.toggle('collapsed');
}

/**
 * Wire the panel's toggle button
 */
export function initDisplayPanel() {
    displayPanelToggle.addEventListener('click', toggleDisplayPanel);
}
