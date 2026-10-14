/**
 * dimensions.js
 * Reads the size a node claims for itself, so a dot can be drawn at that size
 * when it is big enough to see. A tree with `diameter_crown=12` is a 12 m
 * circle; a bench is a bench, and stays a dot.
 *
 * Pure logic: no DOM and no network, so it can be imported in Node for tests.
 */

/** Metres per unit, for the units the diameter keys are written in */
const UNITS = {
    m: 1,
    cm: 0.01,
    mm: 0.001,
    km: 1000,
    ft: 0.3048,
    "'": 0.3048,
    in: 0.0254,
    '"': 0.0254
};

/**
 * Read a length tag value as metres
 * @param {string} value - As tagged: '12', '12 m', '150 cm', "40'", '3 ft'
 * @returns {number|null} Metres, or null when the text is not a length
 */
export function parseLengthMetres(value) {
    const match = /^\s*(\d+(?:[.,]\d+)?)\s*([a-z]+|['"])?\s*$/i.exec(String(value ?? ''));

    if (!match) {
        return null;
    }

    const number = Number(match[1].replace(',', '.'));
    const unit = match[2] ? match[2].toLowerCase() : 'm';

    if (!Number.isFinite(number) || number <= 0 || !Object.prototype.hasOwnProperty.call(UNITS, unit)) {
        return null;
    }
    return number * UNITS[unit];
}

/**
 * The keys that give a node a footprint, most telling first. A tree's crown
 * is what you would see from above; its trunk diameter is a detail that is
 * invisible at the scale of the park it stands in, so it comes second.
 */
const DIAMETER_KEYS = ['diameter_crown', 'diameter'];

/**
 * The diameter a node's tags give it, in metres
 * @param {Object} tags - OSM tags
 * @returns {number|null} Metres, or null when nothing usable is tagged
 */
export function taggedDiameterMetres(tags) {
    for (const key of DIAMETER_KEYS) {
        if (tags && tags[key] !== undefined) {
            const metres = parseLengthMetres(tags[key]);
            if (metres !== null) {
                return metres;
            }
        }
    }
    return null;
}
