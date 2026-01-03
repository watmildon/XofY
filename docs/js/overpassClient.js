/**
 * overpassClient.js
 * Handles communication with the Overpass API
 */

export const DEFAULT_OVERPASS_URL = 'https://overpass.private.coffee/api/interpreter';

/**
 * Execute an Overpass QL query
 * @param {string} query - The Overpass QL query string
 * @param {string} apiUrl - The Overpass API URL (optional, defaults to DEFAULT_OVERPASS_URL)
 * @returns {Promise<Object>} - The JSON response from the API
 */
export async function executeQuery(query, apiUrl = DEFAULT_OVERPASS_URL) {
    if (!query || query.trim() === '') {
        throw new Error('Query cannot be empty');
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'data=' + encodeURIComponent(query)
        });

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Rate limit exceeded. Please wait a moment and try again.');
            } else if (response.status === 400) {
                throw new Error('Invalid query syntax. Please check your Overpass QL.');
            } else {
                throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
            }
        }

        const data = await response.json();
        return data;

    } catch (error) {
        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new Error('Network error. Please check your connection and try again.');
        }
        throw error;
    }
}
