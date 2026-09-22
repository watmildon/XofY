/**
 * tagParser.js
 * Parses the free-form "X" (feature) expression typed by the user into a list
 * of tag filters, and reports what is currently being typed so suggestion
 * sources (taginfo) can offer completions.
 *
 * Supported syntax:
 *   key=value      key equals value
 *   key=*          key exists (a bare `key` means this too, but only where the
 *                  expression makes clear it is a tag and not a plain word)
 *   !key           key does not exist (also written as `key!=*`)
 *   key!=value     key is not value
 *   key~regex      key matches regex (also written as `key=~regex`)
 *   key!~regex     key does not match regex
 * Several filters may be joined with whitespace, `&`, or the bare word `and`.
 * Keys and values may be double-quoted. A backslash escapes the syntax
 * characters `" \ & = ! ~` and whitespace; in front of anything else it is kept
 * as typed, so a regex such as `name~^A\.` keeps its `\.` intact.
 *
 * Pure logic: no DOM and no network, so it can be imported in Node for tests.
 */

/**
 * @typedef {Object} TagFilter
 * @property {string} key - The OSM tag key
 * @property {'='|'!='|'~'|'!~'|'exists'|'missing'} op - The comparison operator
 * @property {string} [value] - The compared value (absent for exists/missing)
 */

/**
 * @typedef {Object} ParseResult
 * @property {Array<TagFilter>} filters - Successfully parsed filters
 * @property {Array<{message: string, token: string}>} errors - Rejected tokens
 */

// Operators, longest first so that `!=` wins over `=` and `=~` over `=`
const OPERATORS = [
    { text: '!=', op: '!=' },
    { text: '!~', op: '!~' },
    { text: '=~', op: '~' },
    { text: '~', op: '~' },
    { text: '=', op: '=' }
];

// A bare (unquoted, unescaped) token that joins filters rather than being one
const JOIN_WORD = /^and$/i;

// Characters a backslash may escape. In front of anything else the backslash is
// kept, because in a value it is almost certainly part of a regex (`\.`, `\d`)
const ESCAPABLE = /["\\&=!~\s]/;

// Keys/values that need no quoting when we render the canonical expression
const BARE_KEY = /^[A-Za-z0-9_:.-]+$/;
const BARE_VALUE = /^[A-Za-z0-9_:.\-/]+$/;

// A single token that could plausibly be an OSM key
const KEY_LIKE = /^[A-Za-z][A-Za-z0-9_]*$/;
// A namespaced key such as `addr:street`, or `addr:` while it is still being typed
const NAMESPACED_KEY_LIKE = /^[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_:]*$/;

/**
 * Split an expression into tokens, honouring double quotes and backslash escapes
 * @param {string} input - The raw expression
 * @returns {Array<{text: string, start: number, end: number}>} Tokens with source offsets
 */
function tokenizeExpression(input) {
    const tokens = [];
    let current = '';
    let start = -1;
    let inQuotes = false;

    const flush = (end) => {
        if (current !== '') {
            tokens.push({ text: current, start, end });
        }
        current = '';
        start = -1;
    };

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        // A backslash escapes the next character anywhere in the expression
        if (char === '\\' && i + 1 < input.length) {
            if (start === -1) start = i;
            current += char + input[i + 1];
            i++;
            continue;
        }

        if (char === '"') {
            if (start === -1) start = i;
            inQuotes = !inQuotes;
            current += char;
            continue;
        }

        if (!inQuotes && (/\s/.test(char) || char === '&')) {
            flush(i);
            continue;
        }

        if (start === -1) start = i;
        current += char;
    }

    flush(input.length);
    return tokens;
}

/**
 * Locate the first operator in a token that is not inside quotes
 * @param {string} token - A single token
 * @returns {{op: string, index: number, length: number}|null} The operator, or null
 */
function findOperator(token) {
    let inQuotes = false;

    for (let i = 0; i < token.length; i++) {
        const char = token[i];

        if (char === '\\') {
            i++;
            continue;
        }
        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (inQuotes) {
            continue;
        }

        for (const candidate of OPERATORS) {
            if (token.startsWith(candidate.text, i)) {
                return { op: candidate.op, index: i, length: candidate.text.length };
            }
        }
    }

    return null;
}

/**
 * Re-join tokens that were split in the middle of an operator, so that
 * `leisure = park` and `leisure= park` mean the same as `leisure=park`
 * @param {Array<{text: string, start: number, end: number}>} tokens - Raw tokens
 * @returns {Array<{text: string, start: number, end: number}>} Merged tokens
 */
function joinSplitOperators(tokens) {
    const merged = [];

    for (const token of tokens) {
        const previous = merged[merged.length - 1];
        const previousOperator = previous ? findOperator(previous.text) : null;
        const ownOperator = findOperator(token.text);

        // The previous token ends with an operator that has no value yet, or
        // this token starts with an operator that has no key
        const danglingBefore = previousOperator !== null &&
            previousOperator.index + previousOperator.length === previous.text.length;
        const danglingAfter = ownOperator !== null && ownOperator.index === 0;

        if (previous && (danglingBefore || danglingAfter)) {
            merged[merged.length - 1] = {
                text: previous.text + token.text,
                start: previous.start,
                end: token.end
            };
            continue;
        }

        merged.push(token);
    }

    return merged;
}

/**
 * Tokenize an expression and re-join operators split by whitespace
 * @param {string} input - The raw expression
 * @returns {Array<{text: string, start: number, end: number}>} Tokens
 */
function splitFilters(input) {
    return joinSplitOperators(tokenizeExpression(input));
}

/**
 * Strip structural quotes and escapes from a raw value fragment.
 * A backslash in front of a syntax character escapes it; in front of anything
 * else both characters are kept, so regex escapes such as `\.` survive.
 * @param {string} raw - Raw fragment as typed
 * @returns {string} The literal text the user meant
 */
function unquoteValue(raw) {
    let out = '';

    for (let i = 0; i < raw.length; i++) {
        const char = raw[i];

        if (char === '\\' && i + 1 < raw.length) {
            const next = raw[i + 1];
            out += ESCAPABLE.test(next) ? next : char + next;
            i++;
            continue;
        }
        if (char === '"') {
            continue;
        }
        out += char;
    }

    return out;
}

/**
 * Strip structural quotes and escapes from a raw key fragment.
 * Keys are never regexes, so every backslash simply escapes what follows.
 * @param {string} raw - Raw fragment as typed
 * @returns {string} The literal key the user meant
 */
function unquoteKey(raw) {
    let out = '';

    for (let i = 0; i < raw.length; i++) {
        const char = raw[i];

        if (char === '\\' && i + 1 < raw.length) {
            out += raw[i + 1];
            i++;
            continue;
        }
        if (char === '"') {
            continue;
        }
        out += char;
    }

    return out;
}

/**
 * Check whether a raw fragment contains a structural (unescaped) quote
 * @param {string} raw - Raw fragment as typed
 * @returns {boolean} True when the fragment was quoted
 */
function isQuoted(raw) {
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '\\') {
            i++;
            continue;
        }
        if (raw[i] === '"') {
            return true;
        }
    }
    return false;
}

/**
 * Quote a key or value if it cannot be written bare
 * @param {string} text - Literal text
 * @param {RegExp} barePattern - Pattern of text that needs no quoting
 * @param {boolean} [mustQuote] - Force quoting even when the text looks bare
 * @returns {string} Text ready to embed in a canonical expression
 */
function quoteIfNeeded(text, barePattern, mustQuote = false) {
    if (!mustQuote && text !== '' && barePattern.test(text)) {
        return text;
    }
    return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * Parse a typed tag expression into filters
 * @param {string} input - The expression as typed
 * @returns {ParseResult} Parsed filters plus any rejected tokens
 */
export function parseTagExpression(input) {
    const filters = [];
    const errors = [];

    if (typeof input !== 'string' || input.trim() === '') {
        return { filters, errors };
    }

    for (const token of splitFilters(input)) {
        const text = token.text;
        const operator = findOperator(text);

        if (!operator) {
            // A bare `and` joins filters. Written as `"and"` or `\and` it is a
            // key like any other, which is why this tests the raw token text
            if (JOIN_WORD.test(text)) {
                continue;
            }

            const negated = text.startsWith('!');
            const key = unquoteKey(negated ? text.slice(1) : text);

            if (!key) {
                errors.push({ message: `Missing tag key in "${text}"`, token: text });
                continue;
            }

            filters.push({ key, op: negated ? 'missing' : 'exists' });
            continue;
        }

        const key = unquoteKey(text.slice(0, operator.index));

        if (!key) {
            errors.push({ message: `Missing tag key in "${text}"`, token: text });
            continue;
        }

        const rawValue = text.slice(operator.index + operator.length);
        const value = unquoteValue(rawValue);

        // An unquoted `*` means "any value", i.e. the key simply exists
        if (value === '*' && !isQuoted(rawValue) && (operator.op === '=' || operator.op === '!=')) {
            filters.push({ key, op: operator.op === '=' ? 'exists' : 'missing' });
            continue;
        }

        filters.push({ key, op: operator.op, value });
    }

    return { filters, errors };
}

/**
 * Render filters back into a canonical expression string
 * @param {Array<TagFilter>} filters - Filters to render
 * @returns {string} Canonical expression (re-parses to the same filters)
 */
export function stringifyFilters(filters) {
    if (!Array.isArray(filters)) {
        return '';
    }

    return filters
        .map(filter => {
            const rawKey = String(filter.key ?? '');
            // A key that reads as the join word has to be quoted to survive a re-parse
            const key = quoteIfNeeded(rawKey, BARE_KEY, JOIN_WORD.test(rawKey));

            // `key=*` rather than a bare `key`: on its own a bare word reads as
            // plain language ("lighthouse"), which is not what it would mean
            if (filter.op === 'exists') {
                return key + '=*';
            }
            if (filter.op === 'missing') {
                return '!' + key;
            }
            return key + filter.op + quoteIfNeeded(String(filter.value ?? ''), BARE_VALUE);
        })
        .join(' ');
}

/**
 * Render one tag value the way the canonical form would, so a suggestion can be
 * spliced into what the user is typing without breaking the expression
 * @param {string} value - The literal value
 * @returns {string} The value, quoted if it needs to be
 */
export function quoteValue(value) {
    return quoteIfNeeded(String(value ?? ''), BARE_VALUE);
}

/**
 * Normalise a typed expression into its canonical form (used for the `x=` share param)
 * @param {string} input - The expression as typed
 * @returns {string} Canonical expression
 */
export function normaliseTagExpression(input) {
    return stringifyFilters(parseTagExpression(input).filters);
}

/**
 * Classify typed text so the UI knows which suggestion sources to offer
 * @param {string} input - The text as typed
 * @returns {'tag'|'ambiguous'|'words'} 'tag' for clear tag syntax, 'ambiguous'
 *     for a lone word that could be a key, 'words' for plain language
 */
export function classifyInput(input) {
    if (typeof input !== 'string' || input.trim() === '') {
        return 'words';
    }

    const tokens = splitFilters(input);

    if (tokens.some(token => findOperator(token.text) !== null)) {
        return 'tag';
    }

    if (tokens.length === 1) {
        const text = tokens[0].text;
        if (text.startsWith('!') || NAMESPACED_KEY_LIKE.test(text)) {
            return 'tag';
        }
        if (KEY_LIKE.test(text)) {
            return 'ambiguous';
        }
    }

    return 'words';
}

/**
 * Describe the key or value fragment under the caret, for autocompletion.
 * `start` and `end` are offsets into the input, so a picked suggestion can be
 * spliced over exactly the fragment being typed.
 * @param {string} input - The text as typed
 * @param {number} [cursor] - Caret offset (defaults to the end of the input)
 * @returns {{field: 'key'|'value', key: string|null, op: string|null,
 *     partial: string, start: number, end: number}} What is being typed
 */
export function getTypingContext(input, cursor) {
    const text = typeof input === 'string' ? input : '';
    const position = cursor === undefined || cursor === null
        ? text.length
        : Math.max(0, Math.min(cursor, text.length));

    const head = text.slice(0, position);
    const tokens = splitFilters(head);
    const last = tokens.length > 0 ? tokens[tokens.length - 1] : null;
    const atCaret = { start: position, end: position };

    // Nothing typed yet, or the caret has moved past the end of a token
    if (!last || last.end < position) {
        const trailing = head.slice(last ? last.end : 0);
        const operator = last ? findOperator(last.text) : null;
        const dangling = operator !== null &&
            operator.index + operator.length === last.text.length;

        // `leisure= ` and `leisure = `: still waiting for a value
        if (dangling && /^\s+$/.test(trailing)) {
            return {
                field: 'value',
                key: unquoteKey(last.text.slice(0, operator.index)),
                op: operator.op,
                partial: '',
                ...atCaret
            };
        }

        return { field: 'key', key: null, op: null, partial: '', ...atCaret };
    }

    // Source text of the token, which may hold whitespace around its operator
    const source = text.slice(last.start, position);
    const operator = findOperator(source);

    if (!operator) {
        const negated = source.startsWith('!');
        const start = last.start + (negated ? 1 : 0);
        return {
            field: 'key',
            key: null,
            op: null,
            partial: unquoteKey(text.slice(start, position)),
            start,
            end: position
        };
    }

    // Skip any whitespace the user left between the operator and the value
    let start = last.start + operator.index + operator.length;
    while (start < position && /\s/.test(text[start])) {
        start++;
    }

    return {
        field: 'value',
        key: unquoteKey(source.slice(0, operator.index).trimEnd()),
        op: operator.op,
        partial: unquoteValue(text.slice(start, position)),
        start,
        end: position
    };
}
