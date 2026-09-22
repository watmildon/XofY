/**
 * qlFilters.js
 * Parses the ready-made Overpass QL selector strings in config/features.js back
 * into the {key, op, value} filters that tagParser produces.
 *
 * The curated features carry their tags as QL text ('["leisure"="park"][name]')
 * because that text is what the app has always sent, byte for byte, and the
 * tests pin it. The Postpass backend needs the same conditions as data rather
 * than as QL, so rather than duplicating every curated feature in a second
 * notation this module reads the QL that is already there.
 *
 * Supported selectors, quoted or bare on either side:
 *   [k]        key exists
 *   [!k]       key does not exist
 *   [k=v]      key equals value
 *   [k!=v]     key is not value
 *   [k~re]     key matches regex (also written [k=~re])
 *   [k!~re]    key does not match regex
 * Anything else throws: these strings are our own data, so a selector this
 * module cannot read is a bug to be found by the test that walks every feature,
 * not something to be silently dropped from a query.
 *
 * Pure logic: no DOM and no network, so it can be imported in Node for tests.
 */

// Longest first, so that `!=` wins over `!` and `=~` over `=`
const OPERATORS = [
    { text: '!=', op: '!=' },
    { text: '!~', op: '!~' },
    { text: '=~', op: '~' },
    { text: '~', op: '~' },
    { text: '=', op: '=' }
];

// Where an unquoted key ends: at the operator, at the closing bracket, or at
// whitespace. Values are not in this set, because a bare value runs to the `]`
const KEY_END = /[\]=!~"\s]/;

/**
 * Decode the escapes queryBuilder's escapeQLString writes, so that a quoted
 * selector round-trips back to the literal text it was built from
 * @param {string} raw - Body of a quoted literal, without the quotes
 * @returns {string} The literal text
 */
function unescapeQLString(raw) {
    let out = '';

    for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== '\\' || i + 1 >= raw.length) {
            out += raw[i];
            continue;
        }

        const next = raw[i + 1];
        // \n \r \t are the only escapes that stand for another character; in
        // front of anything else the backslash is just a quoting device
        out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next;
        i++;
    }

    return out;
}

/**
 * Read a key or value starting at `start`, quoted or bare
 * @param {string} source - The whole selector string
 * @param {number} start - Offset to read from
 * @param {boolean} isValue - True for the right-hand side, which runs to the `]`
 * @returns {{text: string, end: number}} The literal text and where it ended
 * @throws {Error} When a quoted literal is never closed
 */
function readToken(source, start, isValue) {
    if (source[start] === '"') {
        let i = start + 1;
        let body = '';

        while (i < source.length && source[i] !== '"') {
            // A backslash takes the next character with it, so an escaped quote
            // does not end the literal
            if (source[i] === '\\' && i + 1 < source.length) {
                body += source[i] + source[i + 1];
                i += 2;
                continue;
            }
            body += source[i];
            i++;
        }

        if (i >= source.length) {
            throw new Error(`Unterminated quoted literal in Overpass QL: ${source}`);
        }
        return { text: unescapeQLString(body), end: i + 1 };
    }

    let end = start;
    while (end < source.length && source[end] !== ']' && (isValue || !KEY_END.test(source[end]))) {
        end++;
    }

    // A bare value may have been written with a space before the `]`
    return { text: source.slice(start, end).trim(), end };
}

/**
 * Find the operator at `index`, if there is one
 * @param {string} source - The whole selector string
 * @param {number} index - Offset to look at
 * @returns {{op: string, length: number}|null} The operator, or null
 */
function operatorAt(source, index) {
    for (const candidate of OPERATORS) {
        if (source.startsWith(candidate.text, index)) {
            return { op: candidate.op, length: candidate.text.length };
        }
    }
    return null;
}

/**
 * Parse a chain of Overpass QL tag selectors into filters
 * @param {string} text - QL selectors, such as '["leisure"="park"][name]'
 * @returns {Array<{key: string, op: string, value?: string}>} tagParser-shaped filters
 * @throws {Error} When the text is not a chain of tag selectors this module knows
 */
export function parseQlFilters(text) {
    const source = String(text ?? '');
    const filters = [];
    let i = 0;

    while (i < source.length) {
        // Selectors are written back to back, but tolerate spaces between them
        if (/\s/.test(source[i])) {
            i++;
            continue;
        }

        if (source[i] !== '[') {
            throw new Error(`Expected "[" at offset ${i} of Overpass QL: ${source}`);
        }
        i++;

        const negated = source[i] === '!';
        if (negated) {
            i++;
        }

        const key = readToken(source, i, false);
        i = key.end;

        if (!key.text) {
            throw new Error(`Missing tag key at offset ${i} of Overpass QL: ${source}`);
        }

        if (source[i] === ']') {
            filters.push({ key: key.text, op: negated ? 'missing' : 'exists' });
            i++;
            continue;
        }

        // `[!k=v]` is not Overpass QL, and guessing what it might mean would
        // put a condition in the SQL that the QL never had
        if (negated) {
            throw new Error(`"!" cannot be combined with an operator in Overpass QL: ${source}`);
        }

        const operator = operatorAt(source, i);
        if (!operator) {
            throw new Error(`Unsupported selector at offset ${i} of Overpass QL: ${source}`);
        }
        i += operator.length;

        const value = readToken(source, i, true);
        i = value.end;

        if (source[i] !== ']') {
            throw new Error(`Expected "]" at offset ${i} of Overpass QL: ${source}`);
        }
        i++;

        filters.push({ key: key.text, op: operator.op, value: value.text });
    }

    return filters;
}
