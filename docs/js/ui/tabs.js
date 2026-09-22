/**
 * tabs.js
 * The query panel's tab strip (Search, Overpass, Import)
 */

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const shareBtn = document.getElementById('share-btn');
const settingsBtn = document.getElementById('settings-btn');

// Internal tab ids: 'curated' (the Search tab), 'overpass' or 'import'
let currentTab = 'curated';

// Called with the new tab name at the start of every switch
let onSwitch = null;

/**
 * Wire the tab buttons
 * @param {Object} [options]
 * @param {Function} [options.onSwitch] - (tabName) => void, runs before the tab changes
 */
export function initTabs(options = {}) {
    onSwitch = options.onSwitch || null;

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });
}

/**
 * Switch to a specific tab
 * @param {string} tabName - The tab to switch to ('curated', 'overpass', or 'import')
 */
export function switchTab(tabName) {
    currentTab = tabName;

    if (onSwitch) {
        onSwitch(tabName);
    }

    // Update tab button states
    tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update tab content visibility
    tabContents.forEach(content => {
        if (content.dataset.tab === tabName) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    // Show/hide header buttons based on tab
    // Share and settings only work for curated and overpass tabs
    if (tabName === 'import') {
        shareBtn.classList.add('hidden');
        settingsBtn.classList.add('hidden');
    } else {
        shareBtn.classList.remove('hidden');
        settingsBtn.classList.remove('hidden');
    }
}

/**
 * The tab currently shown
 * @returns {string} 'curated', 'overpass' or 'import'
 */
export function getCurrentTab() {
    return currentTab;
}
