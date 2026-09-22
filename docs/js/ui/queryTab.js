/**
 * queryTab.js
 * The Query tab's header: which language the textarea is in.
 *
 * The tab used to be "Overpass" and hold Overpass QL. It now holds whichever
 * language the active data source speaks, so it needs one control to say which
 * - and that control is also what the Execute button under it reads, because a
 * SQL statement has to go to Postpass and a QL query to Overpass whatever the
 * setting says.
 *
 * Changing the data source in Settings changes this select; changing this
 * select does not change the data source. The Search tab keeps running on the
 * setting, so someone who flips the language here to look at the other form of
 * their query has not silently changed where their search goes.
 */

import { backendLanguage } from '../state/appState.js';

const queryTextarea = document.getElementById('overpass-query');
const langSelect = document.getElementById('query-lang-select');
const infoLink = document.getElementById('query-info-link');

/** What each language calls itself, where to read about it, and the empty-box hint */
const LANGUAGES = {
    ql: {
        placeholder: 'Enter an Overpass QL query...',
        docsUrl: 'https://osm-queries.ldodds.com/tutorial/',
        docsTitle: 'Overpass QL Tutorial'
    },
    sql: {
        placeholder: 'Enter a Postpass SQL query (a single SELECT, no semicolon)...',
        docsUrl: 'https://wiki.openstreetmap.org/wiki/Postpass',
        docsTitle: 'Postpass SQL documentation'
    }
};

// Called with the new language whenever it changes, however it changed
let onLangChange = null;

/**
 * The language the textarea is currently in
 * @returns {'sql'|'ql'} The selected language
 */
export function getQueryLang() {
    return langSelect.value === 'sql' ? 'sql' : 'ql';
}

/**
 * Put the placeholder and the tutorial link in step with the language
 * @param {'sql'|'ql'} lang - The language now selected
 */
function applyLanguageChrome(lang) {
    const language = LANGUAGES[lang] || LANGUAGES.ql;

    queryTextarea.placeholder = language.placeholder;
    infoLink.href = language.docsUrl;
    infoLink.title = language.docsTitle;
}

/**
 * Set the language the tab is in
 * @param {'sql'|'ql'} lang - The language to show
 * @param {Object} [options] - Behaviour
 * @param {boolean} [options.silent] - True to skip the change callback, for the
 *     initial load and for changes that came from whoever would be told
 */
function setQueryLang(lang, options = {}) {
    const next = lang === 'sql' ? 'sql' : 'ql';

    langSelect.value = next;
    applyLanguageChrome(next);

    if (!options.silent && onLangChange) {
        onLangChange(next);
    }
}

/**
 * Follow a change of data source, which is where the tab's language comes from
 * until someone sets it here
 * @param {string} backend - The backend now selected
 * @param {Object} [options] - Passed through to setQueryLang
 */
export function syncQueryLangToBackend(backend, options = {}) {
    setQueryLang(backendLanguage(backend), options);
}

/**
 * Wire the language select
 * @param {Object} options - Wiring
 * @param {string} options.lang - The language to start in
 * @param {Function} [options.onLangChange] - (lang) => void
 */
export function initQueryTab(options = {}) {
    onLangChange = options.onLangChange || null;

    // The starting language is not a change, so nothing is told about it
    setQueryLang(options.lang, { silent: true });

    langSelect.addEventListener('change', () => {
        applyLanguageChrome(getQueryLang());
        if (onLangChange) {
            onLangChange(getQueryLang());
        }
    });
}
