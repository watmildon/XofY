#!/usr/bin/env node
/**
 * build-presets.mjs
 * Generates docs/data/presets.json - a slimmed copy of the iD editor's preset
 * list, used to turn plain words typed in the "X" field ("swimming pool") into
 * tags (leisure=swimming_pool).
 *
 * Source: @openstreetmap/id-tagging-schema (ISC licence), fetched from jsDelivr
 * at a pinned version. In 7.x the names and search terms live in the
 * translation file rather than in presets.min.json, so both are downloaded.
 *
 * Kept are the presets that carry tags and can be drawn as a line or an area
 * (the viewer renders shapes, and nodes have no geometry). Presets iD marks
 * `searchable: false` are kept too: iD hides them to steer mappers towards a
 * preferred tagging, but this app searches data that already exists, where
 * amenity=school (1.4M uses) matters far more than education=school (157k).
 *
 * The preset's own `tags` are used rather than `addTags`: `tags` is what
 * identifies the preset in the data, while `addTags` holds the extra tags iD
 * would write when drawing a new object (for example
 * highway=street_lamp + support=*), which would wrongly narrow a search.
 *
 * Each record carries a `count` from taginfo so the suggestion list can rank by
 * how much a tag is actually used. Presets with several tags get the smallest
 * of their tags' counts, marked `approx: true`, since the real total of the
 * combination can only be lower.
 *
 * No dependencies: run with plain `node scripts/build-presets.mjs`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { elementTypesForGeometry } from '../docs/js/search/presets.js';

/** Pinned schema version - bump deliberately, then re-run this script */
const SCHEMA_VERSION = '7.2.0';

const CDN_BASE = `https://cdn.jsdelivr.net/npm/@openstreetmap/id-tagging-schema@${SCHEMA_VERSION}/dist`;
const PRESETS_URL = `${CDN_BASE}/presets.min.json`;
const TRANSLATIONS_URL = `${CDN_BASE}/translations/en.min.json`;

/**
 * taginfo's tags/list takes many tags in one request and answers with each
 * tag's count_all. `key=*` is accepted too and returns the key's own total.
 */
const TAGINFO_URL = 'https://taginfo.openstreetmap.org/api/4/tags/list';
const TAGINFO_BATCH_SIZE = 50;
const TAGINFO_PAUSE_MS = 1000;
const USER_AGENT = 'XofY-preset-builder/1.0 (+https://github.com/watmildon/XofY)';

const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/data/presets.json');

/**
 * Fetch and parse a JSON document
 * @param {string} url - Document location
 * @returns {Promise<Object>} Parsed JSON
 */
async function fetchJson(url) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

/**
 * Wait, to keep the request rate on a public service reasonable
 * @param {number} ms - How long to wait
 * @returns {Promise<void>} Resolves after the delay
 */
function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Look up how often each tag is used, a batch at a time
 * @param {Array<string>} tags - Tags as 'key=value' ('key=*' for any value)
 * @returns {Promise<Map<string, number>>} Tag to count_all
 */
async function fetchTagCounts(tags) {
    const counts = new Map();
    const batches = [];

    for (let i = 0; i < tags.length; i += TAGINFO_BATCH_SIZE) {
        batches.push(tags.slice(i, i + TAGINFO_BATCH_SIZE));
    }

    console.log(`Looking up ${tags.length} tags at taginfo in ${batches.length} batches...`);

    for (const [index, batch] of batches.entries()) {
        if (index > 0) {
            await pause(TAGINFO_PAUSE_MS);
        }

        const url = new URL(TAGINFO_URL);
        url.searchParams.set('tags', batch.join(','));
        const payload = await fetchJson(url);

        for (const row of payload.data || []) {
            // A `key=*` request comes back with a null value and the key's total
            const tag = `${row.key}=${row.value === null ? '*' : row.value}`;
            counts.set(tag, row.count_all || 0);
        }

        process.stdout.write(`\r  batch ${index + 1}/${batches.length}`);
    }

    process.stdout.write('\n');
    return counts;
}

/**
 * Add usage counts to the records, in place
 * @param {Array<Object>} records - Slim preset records
 * @param {Map<string, number>} counts - Tag to count_all
 */
function applyCounts(records, counts) {
    for (const record of records) {
        const entries = Object.entries(record.tags);
        const values = entries.map(([key, value]) => counts.get(`${key}=${value}`) || 0);

        // One tag: its own count. Several: the combination cannot be more
        // common than its rarest tag, so use that and mark it approximate.
        record.count = Math.min(...values);

        if (entries.length > 1) {
            record.approx = true;
        }
    }
}

/**
 * Normalise the translated search terms, which may be a list or a comma-separated string
 * @param {Array<string>|string|undefined} terms - Raw terms from the translation file
 * @returns {Array<string>} Cleaned, de-duplicated terms
 */
function normaliseTerms(terms) {
    const list = Array.isArray(terms)
        ? terms
        : String(terms || '').split(',');

    const cleaned = list
        .map(term => String(term).trim())
        .filter(term => term.length > 0);

    return [...new Set(cleaned)];
}

/**
 * Build the slim preset records
 * @param {Object} presets - presets.min.json contents
 * @param {Object} translations - en.min.json contents
 * @returns {Array<Object>} Slim records, sorted by id
 */
function buildRecords(presets, translations) {
    const strings = translations?.en?.presets?.presets || {};
    const records = [];

    for (const [id, preset] of Object.entries(presets)) {
        // Shared fragments, not real presets
        if (id.startsWith('@')) continue;

        const geometry = Array.isArray(preset.geometry) ? preset.geometry : [];
        if (!geometry.includes('line') && !geometry.includes('area')) continue;

        const tags = preset.tags || {};
        if (Object.keys(tags).length === 0) continue;

        // iD allows a key pattern such as `addr:*` ("any addr: key"), which has
        // no plain Overpass equivalent - drop those presets rather than emit a
        // filter for a key that literally contains an asterisk
        if (Object.keys(tags).some(key => key.includes('*'))) continue;

        const translated = strings[id] || {};
        const name = String(translated.name || '').trim();
        if (!name) continue;

        const terms = normaliseTerms(translated.terms)
            .filter(term => term.toLowerCase() !== name.toLowerCase());

        const record = {
            name,
            tags,
            elementTypes: elementTypesForGeometry(geometry)
        };

        if (terms.length > 0) {
            record.terms = terms;
        }

        // The id orders the file for stable diffs but is not shipped: nothing
        // at runtime looks a preset up by it
        records.push({ id, record });
    }

    records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return records.map(entry => entry.record);
}

/**
 * Download the schema and write the slim preset file
 */
async function main() {
    console.log(`Fetching id-tagging-schema ${SCHEMA_VERSION} from jsDelivr...`);

    const [presets, translations] = await Promise.all([
        fetchJson(PRESETS_URL),
        fetchJson(TRANSLATIONS_URL)
    ]);

    const records = buildRecords(presets, translations);

    if (records.length === 0) {
        throw new Error('No presets survived filtering - the schema layout may have changed');
    }

    // One lookup per distinct tag, however many presets share it
    const tags = [...new Set(records.flatMap(
        record => Object.entries(record.tags).map(([key, value]) => `${key}=${value}`)
    ))].sort();

    applyCounts(records, await fetchTagCounts(tags));

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(records) + '\n');

    const wayOnly = records.filter(record => record.elementTypes === 'way').length;
    const uncounted = records.filter(record => !record.count).length;
    console.log(`Wrote ${records.length} presets (${wayOnly} line-only, ${uncounted} with no taginfo count) to ${OUTPUT_PATH}`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
