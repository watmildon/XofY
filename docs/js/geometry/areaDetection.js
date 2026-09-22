/**
 * areaDetection.js
 * Decides whether a closed way is an area (filled) or a line
 */

/**
 * Check if a closed way should be treated as an area (filled polygon)
 * Based on JOSM's area detection logic
 * @param {Object} tags - OSM tags object
 * @returns {boolean} True if the way should be rendered as a filled area
 */
export function isArea(tags) {
    if (!tags || Object.keys(tags).length === 0) {
        return false;
    }

    // Explicit area tag
    if (tags.area === 'yes') {
        return true;
    }
    if (tags.area === 'no') {
        return false;
    }

    // Primary area-indicating tag keys
    const areaKeys = [
        'building', 'landuse', 'amenity', 'shop', 'building:part',
        'boundary', 'historic', 'place', 'area:highway'
    ];

    for (const key of areaKeys) {
        if (tags[key]) {
            return true;
        }
    }

    // Specific highway values that indicate areas
    if (tags.highway) {
        const areaHighways = ['rest_area', 'services', 'platform'];
        if (areaHighways.includes(tags.highway)) {
            return true;
        }
    }

    // Railway platforms are areas
    if (tags.railway === 'platform') {
        return true;
    }

    // Aeroway aerodromes are areas
    if (tags.aeroway === 'aerodrome') {
        return true;
    }

    // Leisure - most are areas except specific exceptions
    if (tags.leisure) {
        const linearLeisure = ['picnic_table', 'slipway', 'firepit'];
        if (!linearLeisure.includes(tags.leisure)) {
            return true;
        }
    }

    // Natural features that are areas
    if (tags.natural) {
        const areaNatural = [
            'water', 'wood', 'scrub', 'land', 'grassland', 'heath',
            'rock', 'bare_rock', 'sand', 'beach', 'scree', 'glacier',
            'shingle', 'fell', 'reef', 'stone', 'mud', 'landslide'
        ];
        if (areaNatural.includes(tags.natural)) {
            return true;
        }
    }

    // Default: closed ways without area indicators are linear features
    return false;
}
