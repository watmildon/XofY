/**
 * canvasRenderer.js
 * Renders OSM geometries on canvas elements
 */

import { reprojectBounds, reprojectGeometry } from './reproject.js';

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
 * @returns {Path2D} The constructed path
 */
function createPath(geomType, coordinates, projectFn) {
    const path = new Path2D();

    if (geomType === 'Polygon') {
        // Simple polygon: array of [lon, lat] pairs
        coordinates.forEach(([lon, lat], i) => {
            const {x, y} = projectFn(lon, lat);
            if (i === 0) {
                path.moveTo(x, y);
            } else {
                path.lineTo(x, y);
            }
        });
        path.closePath();
    } else if (geomType === 'MultiPolygon') {
        // MultiPolygon: array of polygons, each polygon is [outer, inner1, inner2, ...]
        coordinates.forEach(polygon => {
            // Draw each ring (outer and inners)
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
        });
    } else if (geomType === 'LineString') {
        // LineString: array of [lon, lat] pairs (no closePath)
        coordinates.forEach(([lon, lat], i) => {
            const {x, y} = projectFn(lon, lat);
            if (i === 0) {
                path.moveTo(x, y);
            } else {
                path.lineTo(x, y);
            }
        });
    } else if (geomType === 'MultiLineString') {
        // MultiLineString: array of linestrings
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
    }

    return path;
}

/**
 * Render geometry in relative size mode
 */
function renderRelativeSize(ctx, geomType, coordinates, bounds, width, height, padding, maxDimension, fillColor = '#3388ff') {
    const usableWidth = width - (2 * padding);
    const usableHeight = height - (2 * padding);

    // Calculate scale factor based on the max dimension
    const maxScale = Math.min(usableWidth, usableHeight) / maxDimension;

    // Calculate this geometry's dimension (larger of width or height)
    const geomDimension = Math.max(bounds.width, bounds.height);

    // Calculate size in pixels for this geometry
    const geomSize = geomDimension * maxScale;

    // Handle degenerate bounds
    let renderWidth, renderHeight;
    if (bounds.width === 0 && bounds.height === 0) {
        // Single point - render as small square
        renderWidth = renderHeight = Math.min(10, geomSize);
    } else if (bounds.width === 0) {
        // Vertical line
        renderWidth = 2; // Thin vertical line
        renderHeight = geomSize;
    } else if (bounds.height === 0) {
        // Horizontal line
        renderWidth = geomSize;
        renderHeight = 2; // Thin horizontal line
    } else {
        // Normal case - calculate aspect ratio
        const aspect = bounds.width / bounds.height;
        if (aspect > 1) {
            // Wider than tall
            renderWidth = geomSize;
            renderHeight = geomSize / aspect;
        } else {
            // Taller than wide
            renderHeight = geomSize;
            renderWidth = geomSize * aspect;
        }
    }

    // Center in canvas
    const offsetX = (width - renderWidth) / 2;
    const offsetY = (height - renderHeight) / 2;

    // Create projection function that handles degenerate bounds
    const projectFn = (lon, lat) => {
        let normX, normY;
        if (bounds.width === 0) {
            normX = 0.5; // Center horizontally
        } else {
            normX = (lon - bounds.minLon) / bounds.width;
        }
        if (bounds.height === 0) {
            normY = 0.5; // Center vertically
        } else {
            normY = (bounds.maxLat - lat) / bounds.height; // Flip Y
        }
        return {
            x: offsetX + (normX * renderWidth),
            y: offsetY + (normY * renderHeight)
        };
    };

    // Create and render path
    const path = createPath(geomType, coordinates, projectFn);

    // Determine rendering style based on geometry type
    const isPolygon = geomType === 'Polygon' || geomType === 'MultiPolygon';
    const isLinestring = geomType === 'LineString' || geomType === 'MultiLineString';

    if (isPolygon) {
        ctx.fillStyle = fillColor;
        ctx.fill(path, 'evenodd'); // Use even-odd for holes
        ctx.strokeStyle = darkenColor(fillColor, 20);
        ctx.lineWidth = 2;
        ctx.stroke(path);
    } else if (isLinestring) {
        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 4; // Thicker for visibility
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(path);
    }
}

/**
 * Render geometry in fit-to-cell mode (with aspect ratio preserved)
 */
function renderFitToCell(ctx, geomType, coordinates, bounds, width, height, padding, fillColor = '#3388ff') {
    const usableWidth = width - (2 * padding);
    const usableHeight = height - (2 * padding);

    // Handle degenerate bounds
    let renderWidth, renderHeight;
    if (bounds.width === 0 && bounds.height === 0) {
        // Single point - render as small square
        renderWidth = renderHeight = 10;
    } else if (bounds.width === 0) {
        // Vertical line - use full height, minimal width
        renderWidth = 2;
        renderHeight = usableHeight;
    } else if (bounds.height === 0) {
        // Horizontal line - use full width, minimal height
        renderWidth = usableWidth;
        renderHeight = 2;
    } else {
        // Normal case - calculate aspect ratios
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

    // Center in canvas
    const offsetX = padding + (usableWidth - renderWidth) / 2;
    const offsetY = padding + (usableHeight - renderHeight) / 2;

    // Create projection function that preserves aspect ratio and handles degenerate bounds
    const projectFn = (lon, lat) => {
        let normX, normY;
        if (bounds.width === 0) {
            normX = 0.5; // Center horizontally
        } else {
            normX = (lon - bounds.minLon) / bounds.width;
        }
        if (bounds.height === 0) {
            normY = 0.5; // Center vertically
        } else {
            normY = (bounds.maxLat - lat) / bounds.height; // Flip Y
        }
        return {
            x: offsetX + (normX * renderWidth),
            y: offsetY + (normY * renderHeight)
        };
    };

    // Create and render path
    const path = createPath(geomType, coordinates, projectFn);

    // Determine rendering style based on geometry type
    const isPolygon = geomType === 'Polygon' || geomType === 'MultiPolygon';
    const isLinestring = geomType === 'LineString' || geomType === 'MultiLineString';

    if (isPolygon) {
        ctx.fillStyle = fillColor;
        ctx.fill(path, 'evenodd'); // Use even-odd for holes
        ctx.strokeStyle = darkenColor(fillColor, 20);
        ctx.lineWidth = 2;
        ctx.stroke(path);
    } else if (isLinestring) {
        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 4; // Thicker for visibility
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(path);
    }
}

/**
 * Render a geometry on a canvas
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {Object} geometry - GeometryObject to render
 * @param {Object} options - Rendering options {maintainRelativeSize, maxDimension, fillColor, respectOsmColors}
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

    if (options.maintainRelativeSize && options.maxDimension) {
        // Relative size mode: scale based on the largest geometry
        renderRelativeSize(ctx, geomType, coordinates, bounds, width, height, padding, options.maxDimension, fillColor);
    } else {
        // Fit to cell mode: each geometry fills its canvas
        renderFitToCell(ctx, geomType, coordinates, bounds, width, height, padding, fillColor);
    }
}
