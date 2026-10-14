/**
 * canvasRenderer.js
 * Renders OSM geometries on canvas elements
 */

import { reprojectBounds, reprojectGeometry } from './reproject.js';
import { taggedDiameterMetres } from './geometry/dimensions.js';

/** Earth radius the projection in reproject.js leaves out, in metres */
const EARTH_RADIUS_M = 6378137;

/**
 * Calculate relative luminance of a color (WCAG formula)
 * @param {string} hexColor - Hex color (e.g., '#3388ff')
 * @returns {number} Relative luminance (0-1)
 */
function getRelativeLuminance(hexColor) {
    // Remove # if present
    const hex = hexColor.replace('#', '');

    // Parse RGB
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    // Apply gamma correction
    const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

    // Calculate relative luminance
    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Determine if a color is light or dark
 * @param {string} hexColor - Hex color (e.g., '#3388ff')
 * @returns {string} 'light' or 'dark'
 */
function getColorBrightness(hexColor) {
    const luminance = getRelativeLuminance(hexColor);
    // Threshold of 0.5 works well for most cases
    return luminance > 0.5 ? 'light' : 'dark';
}

/**
 * Get appropriate background color for a given geometry color
 * Uses two distinct backgrounds for better contrast
 * @param {string} geometryColor - Hex color of the geometry
 * @returns {string} Hex color for background
 */
function getContrastBackground(geometryColor) {
    const brightness = getColorBrightness(geometryColor);

    // Light geometries get a dark charcoal background
    // Dark geometries get a light gray background
    if (brightness === 'light') {
        return '#2a2a2a'; // Dark charcoal
    } else {
        return '#e8e8e8'; // Light gray
    }
}

/**
 * Darken a hex color by a percentage
 * @param {string} color - Hex color (e.g., '#3388ff')
 * @param {number} percent - Percentage to darken (0-100)
 * @returns {string} Darkened hex color
 */
function darkenColor(color, percent = 20) {
    // Remove # if present
    const hex = color.replace('#', '');

    // Parse RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Darken
    const factor = 1 - (percent / 100);
    const newR = Math.round(r * factor);
    const newG = Math.round(g * factor);
    const newB = Math.round(b * factor);

    // Convert back to hex
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
}

/**
 * Project lat/lon coordinates to canvas x/y pixels
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @param {Object} bounds - Bounding box {minLat, maxLat, minLon, maxLon, width, height}
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @param {number} padding - Padding in pixels
 * @returns {Object} {x, y} canvas coordinates
 */
function projectToCanvas(lon, lat, bounds, canvasWidth, canvasHeight, padding = 10) {
    // Scale to canvas with padding
    const usableWidth = canvasWidth - (2 * padding);
    const usableHeight = canvasHeight - (2 * padding);

    // Handle degenerate bounds (zero width or height)
    let x, y;

    if (bounds.width === 0) {
        // Vertical line - center horizontally, vary vertically
        x = padding + (usableWidth / 2);
        y = bounds.height > 0
            ? padding + ((bounds.maxLat - lat) / bounds.height) * usableHeight
            : padding + (usableHeight / 2);
    } else if (bounds.height === 0) {
        // Horizontal line - vary horizontally, center vertically
        x = padding + ((lon - bounds.minLon) / bounds.width) * usableWidth;
        y = padding + (usableHeight / 2);
    } else {
        // Normal case - both dimensions non-zero
        x = padding + ((lon - bounds.minLon) / bounds.width) * usableWidth;
        y = padding + ((bounds.maxLat - lat) / bounds.height) * usableHeight;
    }

    return { x, y };
}

/**
 * Create a path from coordinates (handles Polygon, MultiPolygon, LineString, MultiLineString)
 * @param {string} geomType - 'Polygon', 'MultiPolygon', 'LineString', or 'MultiLineString'
 * @param {Array} coordinates - Coordinate array
 * @param {Function} projectFn - Function to project [lon, lat] to {x, y}
 * @returns {Path2D|Array<Path2D>} The constructed path(s) - single Path2D for Polygon/LineString, array for Multi* types
 */
function createPath(geomType, coordinates, projectFn) {
    if (geomType === 'Polygon') {
        // Simple polygon: array of [lon, lat] pairs
        const path = new Path2D();
        coordinates.forEach(([lon, lat], i) => {
            const {x, y} = projectFn(lon, lat);
            if (i === 0) {
                path.moveTo(x, y);
            } else {
                path.lineTo(x, y);
            }
        });
        path.closePath();
        return path;
    } else if (geomType === 'MultiPolygon') {
        // MultiPolygon: array of polygons, each polygon is [outer, inner1, inner2, ...]
        // Return array of paths, one per polygon
        return coordinates.map(polygon => {
            const path = new Path2D();
            // Draw each ring (outer and inners) in this polygon
            polygon.forEach(ring => {
                ring.forEach(([lon, lat], i) => {
                    const {x, y} = projectFn(lon, lat);
                    if (i === 0) {
                        path.moveTo(x, y);
                    } else {
                        path.lineTo(x, y);
                    }
                });
                path.closePath();
            });
            return path;
        });
    } else if (geomType === 'LineString') {
        // LineString: array of [lon, lat] pairs (no closePath)
        const path = new Path2D();
        coordinates.forEach(([lon, lat], i) => {
            const {x, y} = projectFn(lon, lat);
            if (i === 0) {
                path.moveTo(x, y);
            } else {
                path.lineTo(x, y);
            }
        });
        return path;
    } else if (geomType === 'MultiLineString') {
        // MultiLineString: array of linestrings
        const path = new Path2D();
        coordinates.forEach(linestring => {
            linestring.forEach(([lon, lat], i) => {
                const {x, y} = projectFn(lon, lat);
                if (i === 0) {
                    path.moveTo(x, y);
                } else {
                    path.lineTo(x, y);
                }
            });
        });
        return path;
    }
}

/**
 * Where a geometry's bounding box lands on the canvas: its size in pixels and
 * the offset of its top-left corner. The two display modes differ only here.
 * @param {Object} bounds - Projected bounds {width, height}
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {number} padding - Padding in pixels
 * @param {number|null} maxDimension - The largest dimension of any geometry
 *     on the page, for relative size mode; null fits each to its cell
 * @returns {{renderWidth: number, renderHeight: number, offsetX: number, offsetY: number}}
 */
function layoutBounds(bounds, width, height, padding, maxDimension) {
    const usableWidth = width - (2 * padding);
    const usableHeight = height - (2 * padding);
    let renderWidth, renderHeight;

    if (maxDimension) {
        // Relative size mode: scale based on the largest geometry
        const maxScale = Math.min(usableWidth, usableHeight) / maxDimension;
        const geomDimension = Math.max(bounds.width, bounds.height);
        const geomSize = geomDimension * maxScale;

        if (bounds.width === 0 && bounds.height === 0) {
            // Single point - render as small square
            renderWidth = renderHeight = Math.min(10, geomSize);
        } else if (bounds.width === 0) {
            // Vertical line
            renderWidth = 2;
            renderHeight = geomSize;
        } else if (bounds.height === 0) {
            // Horizontal line
            renderWidth = geomSize;
            renderHeight = 2;
        } else {
            const aspect = bounds.width / bounds.height;
            if (aspect > 1) {
                renderWidth = geomSize;
                renderHeight = geomSize / aspect;
            } else {
                renderHeight = geomSize;
                renderWidth = geomSize * aspect;
            }
        }

        // Center in canvas
        return {
            renderWidth,
            renderHeight,
            offsetX: (width - renderWidth) / 2,
            offsetY: (height - renderHeight) / 2
        };
    }

    // Fit to cell mode: each geometry fills its canvas, aspect preserved
    if (bounds.width === 0 && bounds.height === 0) {
        renderWidth = renderHeight = 10;
    } else if (bounds.width === 0) {
        renderWidth = 2;
        renderHeight = usableHeight;
    } else if (bounds.height === 0) {
        renderWidth = usableWidth;
        renderHeight = 2;
    } else {
        const boundsAspect = bounds.width / bounds.height;
        const canvasAspect = usableWidth / usableHeight;

        if (boundsAspect > canvasAspect) {
            // Bounds are relatively wider than canvas - constrain by width
            renderWidth = usableWidth;
            renderHeight = usableWidth / boundsAspect;
        } else {
            // Bounds are relatively taller than canvas - constrain by height
            renderHeight = usableHeight;
            renderWidth = usableHeight * boundsAspect;
        }
    }

    return {
        renderWidth,
        renderHeight,
        offsetX: padding + (usableWidth - renderWidth) / 2,
        offsetY: padding + (usableHeight - renderHeight) / 2
    };
}

/**
 * A function from [lon, lat] (projected) to canvas {x, y}, for a layout.
 * Sub-features are drawn through the same function as the feature that
 * encloses them, which is what puts them in the right place inside it.
 * @param {Object} bounds - Projected bounds {minLon, maxLat, width, height}
 * @param {Object} layout - From layoutBounds()
 * @returns {Function} (lon, lat) => {x, y}
 */
function makeProjection(bounds, layout) {
    return (lon, lat) => {
        // A degenerate dimension is centred
        const normX = bounds.width === 0 ? 0.5 : (lon - bounds.minLon) / bounds.width;
        const normY = bounds.height === 0 ? 0.5 : (bounds.maxLat - lat) / bounds.height; // Flip Y
        return {
            x: layout.offsetX + (normX * layout.renderWidth),
            y: layout.offsetY + (normY * layout.renderHeight)
        };
    };
}

/**
 * Draw one geometry through a projection
 * @param {CanvasRenderingContext2D} ctx - Where to draw
 * @param {string} geomType - 'Polygon', 'MultiPolygon', 'LineString',
 *     'MultiLineString' or 'Point'
 * @param {Array} coordinates - Projected coordinates
 * @param {Function} projectFn - From makeProjection()
 * @param {Object} style - {color, polygonLineWidth, lineWidth, pointRadius}
 */
function drawShape(ctx, geomType, coordinates, projectFn, style) {
    if (geomType === 'Point') {
        // A node: a dot where it is
        const { x, y } = projectFn(coordinates[0], coordinates[1]);
        ctx.beginPath();
        ctx.arc(x, y, style.pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = style.color;
        ctx.fill();
        ctx.strokeStyle = darkenColor(style.color, 20);
        ctx.lineWidth = 1;
        ctx.stroke();
        return;
    }

    const paths = createPath(geomType, coordinates, projectFn);
    const isPolygon = geomType === 'Polygon' || geomType === 'MultiPolygon';
    const isLinestring = geomType === 'LineString' || geomType === 'MultiLineString';

    if (isPolygon) {
        ctx.fillStyle = style.color;
        ctx.strokeStyle = darkenColor(style.color, 20);
        ctx.lineWidth = style.polygonLineWidth;

        // Handle both single path and array of paths
        const pathArray = Array.isArray(paths) ? paths : [paths];
        pathArray.forEach(path => {
            ctx.fill(path, 'evenodd'); // Use even-odd for holes
            ctx.stroke(path);
        });
    } else if (isLinestring) {
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(paths); // LineString always returns single path
    }
}

/** How the main feature is drawn */
const MAIN_STYLE = { polygonLineWidth: 2, lineWidth: 4, pointRadius: 8 };

/** How a sub-feature is drawn: finer, since it sits inside something */
const SUB_STYLE = { polygonLineWidth: 1, lineWidth: 2 };

/** Radius of a node sub-feature's dot, in canvas pixels, until a slider says otherwise */
export const DEFAULT_SUB_FEATURE_DOT_SIZE = 5;

/**
 * How many canvas pixels a metre on the ground is at a latitude, for a layout
 * @param {Object} bounds - Projected bounds of what is on the canvas
 * @param {Object} layout - From layoutBounds()
 * @param {number} lat - Latitude in degrees, where the metre is measured
 * @returns {number|null} Pixels per metre, or null for a canvas with no scale
 *     (a single point has none)
 */
function pixelsPerMetre(bounds, layout, lat) {
    const pixelsPerUnit = bounds.width > 0
        ? layout.renderWidth / bounds.width
        : bounds.height > 0 ? layout.renderHeight / bounds.height : null;

    if (pixelsPerUnit === null) {
        return null;
    }
    // The projection is Mercator without the Earth radius, so one unit is
    // R metres at the equator and R * cos(lat) metres at this latitude
    return pixelsPerUnit / (EARTH_RADIUS_M * Math.cos(lat * Math.PI / 180));
}

/**
 * The radius to draw a node sub-feature with: the dot size, or the size its
 * tags give it when that is bigger and the canvas has a scale to draw it at
 * @param {Object} sub - A parsed node sub-feature (Point geometry, tags)
 * @param {number} dotRadius - The slider's dot radius
 * @param {Object} bounds - Projected bounds of the main feature
 * @param {Object} layout - From layoutBounds()
 * @returns {number} Radius in canvas pixels
 */
function nodeRadius(sub, dotRadius, bounds, layout) {
    const diameter = taggedDiameterMetres(sub.tags);

    if (diameter === null) {
        return dotRadius;
    }

    const scale = pixelsPerMetre(bounds, layout, sub.geometry.coordinates[1]);
    return scale === null ? dotRadius : Math.max(dotRadius, (diameter / 2) * scale);
}

/** Sub-feature colour when nothing says otherwise */
export const DEFAULT_SUB_FEATURE_COLOR = '#ff7f0e';

/**
 * Render a geometry on a canvas, with any sub-features it encloses on top
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {Object} geometry - GeometryObject to render
 * @param {Object} options - Rendering options {maintainRelativeSize,
 *     maxDimension, fillColor, respectOsmColors, subFeatureColor,
 *     subFeatureDotSize}
 */
export function renderGeometry(canvas, geometry, options = {}) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 10;

    // Clear canvas first
    ctx.clearRect(0, 0, width, height);

    const bounds = reprojectBounds(geometry.bounds);

    // Determine fill color: respect OSM color if enabled and present, otherwise use global
    const fillColor = (options.respectOsmColors && geometry.color)
        ? geometry.color
        : (options.fillColor || '#3388ff');

    // If geometry has a color (from OSM), use contrast-aware background
    // Otherwise, keep transparent background to show CSS theme
    if (options.respectOsmColors && geometry.color) {
        const bgColor = getContrastBackground(geometry.color);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);
    }

    const geomType = geometry.geometry.type;
    const coordinates = reprojectGeometry(geometry.geometry.coordinates);

    // Handle degenerate point (zero width AND height) - but not degenerate lines
    if (bounds.width === 0 && bounds.height === 0) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(width / 2 - 5, height / 2 - 5, 10, 10);
        return;
    }

    const maxDimension = options.maintainRelativeSize && options.maxDimension
        ? options.maxDimension
        : null;
    const layout = layoutBounds(bounds, width, height, padding, maxDimension);
    const projectFn = makeProjection(bounds, layout);

    drawShape(ctx, geomType, coordinates, projectFn, { ...MAIN_STYLE, color: fillColor });

    // Sub-features go on top, in their own colour - or in their own OSM
    // colour, when they have one and that is being respected
    const subColor = options.subFeatureColor || DEFAULT_SUB_FEATURE_COLOR;
    const dotRadius = Number.isFinite(options.subFeatureDotSize) && options.subFeatureDotSize > 0
        ? options.subFeatureDotSize
        : DEFAULT_SUB_FEATURE_DOT_SIZE;
    (geometry.subFeatures || []).forEach(sub => {
        const color = options.respectOsmColors && sub.color ? sub.color : subColor;
        const pointRadius = sub.geometry.type === 'Point'
            ? nodeRadius(sub, dotRadius, bounds, layout)
            : dotRadius;
        drawShape(
            ctx,
            sub.geometry.type,
            reprojectGeometry(sub.geometry.coordinates),
            projectFn,
            { ...SUB_STYLE, color, pointRadius }
        );
    });
}
