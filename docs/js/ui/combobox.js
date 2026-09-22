/**
 * combobox.js
 * A small text input with a suggestion list under it, used for both halves of
 * the "X of Y" search. No dependencies and no framework: it renders rows,
 * tracks which one is active, and tells the caller what was committed.
 *
 * Suggestions arrive as groups so the list can carry small headings:
 *   [{ label: 'Curated', items: [{ primary, secondary, meta, value }] }]
 *
 * A row normally replaces the whole field. One carrying
 * `splice: {start, end, text, keepOpen}` replaces just that slice of the text,
 * which is how a tag key or value completes what is being typed.
 *
 * The caller learns the difference between a picked suggestion (onPick) and
 * free text the user typed and pressed Enter on (onEnterText).
 */

/** Marks a row that does something rather than standing for a value */
const ACTION_ROW = 'action';

/**
 * Rows a suggestion source may offer when only one group can match. Then there
 * is nothing to make room for, so the whole list is offered - all 18 curated
 * features, all 30 areas - and the list scrolls if it must. It lives here
 * rather than in one of the two sources, which both cap themselves by it.
 */
export const SINGLE_GROUP_ROWS = 50;

/** Gap kept between the list and the edge of the window */
const LIST_MARGIN = 8;

/** The list never shrinks below this, even in a cramped viewport */
const MIN_LIST_HEIGHT = 140;

let comboboxCount = 0;

/**
 * Build a combobox inside a container element
 * @param {HTMLElement} root - Container to render into (emptied first)
 * @param {Object} options - Behaviour
 * @param {string} [options.inputId] - Id for the input, so a <label for> works
 * @param {string} [options.placeholder] - Input placeholder
 * @param {string} [options.ariaLabel] - Accessible name when there is no label
 * @param {Function} [options.getSuggestions] - (text, {committed, caret}) => groups or Promise<groups>
 * @param {Function} [options.getActionRow] - (text, {committed, caret}) => an extra row, or null
 * @param {Function} [options.getEmptyMessage] - (text, {committed}) => message when
 *     nothing matched, or null to show nothing
 * @param {Function} [options.onPick] - (item) => void, a suggestion was chosen
 * @param {Function} [options.onEnterText] - (text) => void, Enter on free text
 * @param {Function} [options.onInput] - (text) => void, the text changed
 * @param {Function} [options.onBlurText] - (text, {committed}) => void, focus left the field
 * @returns {Object} Controller for the combobox
 */
export function createCombobox(root, options = {}) {
    const id = options.inputId || `combobox-${++comboboxCount}`;
    const listId = `${id}-listbox`;

    root.classList.add('combobox');
    root.innerHTML = '';

    // Status text is announced here, since a row inside the listbox is not
    // reliably read out when it appears
    const live = document.createElement('span');
    live.className = 'combobox-live';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');

    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'combobox-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = options.placeholder || '';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-autocomplete', 'list');
    if (options.ariaLabel) {
        input.setAttribute('aria-label', options.ariaLabel);
    }

    const list = document.createElement('ul');
    list.className = 'combobox-list hidden';
    list.id = listId;
    list.setAttribute('role', 'listbox');

    root.appendChild(input);
    root.appendChild(list);
    root.appendChild(live);

    // Rows currently rendered, in the order the arrow keys walk them
    let rows = [];
    let activeIndex = -1;
    let open = false;
    let selected = null;
    // Groups pinned by presentGroups(), shown until the user types again
    let override = null;
    // The groups currently on show, so a status message can appear above them
    let lastGroups = [];
    // Resolves when the suggestions being fetched have been rendered
    let pendingRefresh = Promise.resolve();
    // Guards against a slow suggestion source overwriting a newer one
    let requestToken = 0;

    /**
     * Render a set of groups into the list
     * @param {Array<Object>} groups - Groups of suggestion items
     * @param {Object} [status] - A non-selectable row: {text, kind}
     */
    function render(groups, status) {
        lastGroups = groups || [];

        // A re-render (a group arriving late) must not lose the user's place,
        // so the highlight is restored by what it pointed at, not by index
        const wasActive = activeIndex >= 0 && rows[activeIndex] ? rowIdentity(rows[activeIndex]) : null;

        list.innerHTML = '';
        rows = [];

        if (status) {
            const li = document.createElement('li');
            li.className = `combobox-status combobox-status-${status.kind || 'info'}`;
            li.setAttribute('role', 'presentation');
            li.textContent = status.text;
            list.appendChild(li);
        }

        live.textContent = status ? status.text : '';

        // The list can grow after it opened (a group arriving late), so it is
        // re-fitted on every render, not just the first
        if (open) {
            fitToViewport();
        }

        (groups || []).forEach(group => {
            const items = (group.items || []).filter(Boolean);
            if (items.length === 0) {
                return;
            }

            const groupLabel = group.label || '';

            if (group.label) {
                const heading = document.createElement('li');
                heading.className = 'combobox-group';
                heading.setAttribute('role', 'presentation');
                heading.textContent = group.label;
                list.appendChild(heading);
            }

            items.forEach(item => {
                const index = rows.length;
                const li = document.createElement('li');
                li.className = 'combobox-option';
                li.id = `${id}-option-${index}`;
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');
                li.dataset.index = String(index);

                const primary = document.createElement('span');
                primary.className = 'combobox-primary';
                primary.textContent = item.primary;
                li.appendChild(primary);

                if (item.secondary) {
                    const secondary = document.createElement('span');
                    secondary.className = 'combobox-secondary';
                    secondary.textContent = item.secondary;
                    li.appendChild(secondary);
                }

                if (item.meta) {
                    const meta = document.createElement('span');
                    meta.className = 'combobox-meta';
                    meta.textContent = item.meta;
                    li.appendChild(meta);
                }

                if (item.kind === ACTION_ROW) {
                    li.classList.add('combobox-option-action');
                }

                list.appendChild(li);
                rows.push({ item, element: li, groupLabel });
            });
        });

        const restored = wasActive === null
            ? -1
            : rows.findIndex(row => rowIdentity(row) === wasActive);

        if (restored >= 0) {
            setActive(restored);
        } else {
            setActive(rows.length > 0 && override ? 0 : -1);
        }
    }

    /**
     * What a row stands for, so the highlight survives a re-render.
     * The secondary text is part of it: two presets can share a name
     * ("School Grounds") and differ only in their tags.
     * @param {Object} row - A rendered row
     * @returns {string} A stable identity for the row
     */
    function rowIdentity(row) {
        return `${row.groupLabel}\u0000${row.item.primary}\u0000${row.item.secondary ?? ''}`;
    }

    /**
     * Highlight a row and point aria-activedescendant at it
     * @param {number} index - Row index, or -1 for none
     */
    function setActive(index) {
        activeIndex = index;

        rows.forEach((row, i) => {
            const isActive = i === index;
            row.element.classList.toggle('active', isActive);
            row.element.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        if (index >= 0 && rows[index]) {
            input.setAttribute('aria-activedescendant', rows[index].element.id);
            rows[index].element.scrollIntoView({ block: 'nearest' });
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    }

    /**
     * Mark the field as holding something that was never chosen, so the
     * disabled Execute button is not the only clue
     * @param {boolean} invalid - Whether the text stands for nothing
     */
    function setInvalid(invalid) {
        input.classList.toggle('combobox-input-unchosen', invalid);

        if (invalid) {
            input.setAttribute('aria-invalid', 'true');
        } else {
            input.removeAttribute('aria-invalid');
        }
    }

    /**
     * Keep the list inside the window. On a phone the fields sit well down the
     * page and a soft keyboard shrinks the viewport further, so the list is
     * sized to whatever room is left under the input rather than spilling off
     * the bottom.
     */
    function fitToViewport() {
        const below = window.innerHeight - input.getBoundingClientRect().bottom - LIST_MARGIN * 2;
        list.style.maxHeight = `${Math.max(MIN_LIST_HEIGHT, below)}px`;

        if (below < MIN_LIST_HEIGHT) {
            list.scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * Show the list, unless the field has meanwhile lost focus (a slow
     * suggestion source must not pop a list open on an unfocused field)
     */
    function openList() {
        if (open || document.activeElement !== input) {
            return;
        }
        open = true;
        list.classList.remove('hidden');
        input.setAttribute('aria-expanded', 'true');
        fitToViewport();
    }

    /**
     * Hide the list and drop the highlight
     */
    function closeList() {
        if (!open) {
            return;
        }
        open = false;
        list.classList.add('hidden');
        input.setAttribute('aria-expanded', 'false');
        setActive(-1);
    }

    /**
     * Ask the suggestion source for rows matching the current text and show them
     */
    function refresh() {
        pendingRefresh = runRefresh();
        return pendingRefresh;
    }

    /**
     * Ask the suggestion source for rows matching the current text and show them
     */
    async function runRefresh() {
        // A pinned result (a place search) survives; a status message does not,
        // so returning to the field offers suggestions again
        if (override && override.sticky) {
            render(override.groups, override.status);
            openList();
            return;
        }
        override = null;

        const text = input.value;
        const token = ++requestToken;
        // The text in a committed field is a label the user chose, not
        // something they typed, so it must not narrow the list
        const context = { committed: selected !== null, caret: input.selectionStart };
        const action = options.getActionRow ? options.getActionRow(text, context) : null;

        let groups;
        try {
            groups = options.getSuggestions ? await options.getSuggestions(text, context) : [];
        } catch (error) {
            if (token !== requestToken) {
                return;
            }
            console.warn('Suggestion lookup failed:', error);
            render(action ? [{ items: [action] }] : [], { text: 'Could not load suggestions', kind: 'error' });
            openList();
            return;
        }

        // A newer keystroke has already asked for its own suggestions
        if (token !== requestToken) {
            return;
        }

        const all = [...(groups || [])];
        if (action) {
            all.push({ items: [action] });
        }

        const empty = all.every(group => (group.items || []).length === 0);
        const message = options.getEmptyMessage
            ? options.getEmptyMessage(text, context)
            : 'No matches';

        render(all, empty && message ? { text: message, kind: 'empty' } : null);
        openList();
    }

    /**
     * Commit a row the user chose
     * @param {number} index - Row index
     */
    function pick(index) {
        const row = rows[index];
        if (!row) {
            return;
        }

        const item = row.item;
        override = null;
        setInvalid(false);

        // A splice row replaces one fragment of the text (the key or value
        // being typed) instead of standing for the whole field
        if (item.splice) {
            const before = input.value.slice(0, item.splice.start);
            const after = input.value.slice(item.splice.end);
            input.value = before + item.splice.text + after;

            const caret = (before + item.splice.text).length;
            input.setSelectionRange(caret, caret);
            selected = null;

            if (options.onPick) {
                options.onPick(item);
            }

            if (item.splice.keepOpen) {
                // Carry on: the next fragment wants its own suggestions
                refresh();
            } else {
                closeList();
            }
            return;
        }

        selected = item;
        input.value = item.text !== undefined ? item.text : item.primary;
        closeList();

        if (options.onPick) {
            options.onPick(item);
        }
    }

    input.addEventListener('input', () => {
        selected = null;
        override = null;
        setInvalid(false);
        if (options.onInput) {
            options.onInput(input.value);
        }
        refresh();
    });

    input.addEventListener('focus', () => {
        refresh();
    });

    // Clicking a field that already has focus (right after picking a row, or
    // after Escape) must bring the list back
    input.addEventListener('click', () => {
        if (!open) {
            refresh();
        }
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();

            if (!open) {
                refresh();
                return;
            }
            if (rows.length === 0) {
                return;
            }

            const step = event.key === 'ArrowDown' ? 1 : -1;
            const next = activeIndex === -1
                ? (step === 1 ? 0 : rows.length - 1)
                : (activeIndex + step + rows.length) % rows.length;
            setActive(next);
            return;
        }

        if (event.key === 'Enter') {
            if (open && activeIndex >= 0) {
                event.preventDefault();
                pick(activeIndex);
                return;
            }

            event.preventDefault();
            closeList();
            if (options.onEnterText) {
                options.onEnterText(input.value);
            }
            return;
        }

        if (event.key === 'Escape') {
            if (open) {
                event.stopPropagation();
                closeList();
            }
            return;
        }

        if (event.key === 'Tab') {
            // Move on without silently committing a highlighted row
            closeList();
        }
    });

    // Keep focus on the input so the blur handler does not close the list
    // before the click lands on a row
    list.addEventListener('mousedown', (event) => {
        event.preventDefault();
    });

    list.addEventListener('click', (event) => {
        const option = event.target.closest('.combobox-option');
        if (option) {
            pick(Number(option.dataset.index));
        }
    });

    input.addEventListener('blur', (event) => {
        if (root.contains(event.relatedTarget)) {
            return;
        }

        // Anything still in flight is no longer wanted
        requestToken++;
        closeList();

        if (options.onBlurText) {
            options.onBlurText(input.value, { committed: selected !== null });
        }
    });

    const onDocumentPointerDown = (event) => {
        if (!root.contains(event.target)) {
            closeList();
        }
    };
    document.addEventListener('mousedown', onDocumentPointerDown);
    document.addEventListener('touchstart', onDocumentPointerDown, { passive: true });

    return {
        input,
        list,

        /**
         * Claim the field for a lookup that will finish later. Anything the
         * user does in the meantime (typing, blurring, picking) invalidates the
         * token, so a late answer can tell that it is no longer wanted.
         * @returns {number} The token to pass back to presentGroups/showStatus
         */
        beginRequest() {
            return ++requestToken;
        },

        /**
         * Put text in the input without firing input handlers
         * @param {string} text - Text to show
         * @param {Object|null} [item] - The item it stands for, if any
         */
        setValue(text, item = null) {
            input.value = text || '';
            selected = item;
            setInvalid(false);
            override = null;
            requestToken++;
            closeList();
        },

        /**
         * Show a fixed set of groups (a place search result, say) until the
         * user types again
         * @param {Array<Object>} groups - Groups to show
         * @param {Object} [status] - Optional message row above them
         * @param {number} [token] - Token from beginRequest; a stale one is ignored
         */
        presentGroups(groups, status, token) {
            if (token !== undefined && token !== requestToken) {
                return;
            }
            override = { groups, status, sticky: true };
            render(groups, status);
            openList();
        },

        /**
         * Show a single message row, for "searching..." or an error
         * @param {string} text - Message
         * @param {string} [kind] - 'info', 'empty' or 'error'
         * @param {number} [token] - Token from beginRequest; a stale one is ignored
         */
        showStatus(text, kind = 'info', token) {
            if (token !== undefined && token !== requestToken) {
                return;
            }
            // Above whatever is already on offer, never instead of it
            const status = { text, kind };
            override = { groups: lastGroups, status, sticky: false };
            render(lastGroups, status);
            openList();
        },

        /**
         * Take the row that best answers the typed text: an exact match on the
         * primary text if there is one, otherwise the first row. Waits for
         * suggestions that are still being fetched.
         * @param {string} text - What the user typed
         * @param {Function} [accept] - (item) => boolean, which rows may be taken
         * @returns {Promise<boolean>} True when a row was picked
         */
        async pickBest(text, accept) {
            await pendingRefresh;

            const usable = rows
                .map((row, index) => ({ row, index }))
                .filter(entry => !accept || accept(entry.row.item));

            if (usable.length === 0) {
                return false;
            }

            const wanted = String(text ?? '').trim().toLowerCase();
            const exact = usable.find(entry => String(entry.row.item.primary).toLowerCase() === wanted);

            pick(exact ? exact.index : usable[0].index);
            return true;
        },

        /**
         * Mark or unmark the field as holding something that was never chosen
         * @param {boolean} invalid - Whether the text stands for nothing
         */
        setInvalid,

        /** Re-run the suggestion source (used when late data arrives) */
        refresh
    };
}
