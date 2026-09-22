/**
 * lazyLoading.js
 * Appends the grid in batches as the page scrolls, and the back-to-top button
 */

import { state } from '../state/appState.js';
import { appendBatch } from '../gridLayout.js';
import { renderGeometriesForBatch } from './rendering.js';
import { setupPreviewListeners } from '../ui/modals.js';

const gridContainer = document.getElementById('geometry-grid');
const lazyLoadingDiv = document.getElementById('lazy-loading');
const backToTopBtn = document.getElementById('back-to-top');

/**
 * Load more items for lazy loading
 */
export function loadMoreItems() {
    const lazyLoad = state.lazyLoad;

    if (!lazyLoad.enabled || lazyLoad.isLoading) {
        return;
    }

    if (lazyLoad.renderedCount >= lazyLoad.totalCount) {
        return; // All items loaded
    }

    lazyLoad.isLoading = true;
    lazyLoadingDiv.classList.remove('hidden');

    // Calculate batch range
    const startIndex = lazyLoad.renderedCount;
    const endIndex = Math.min(
        startIndex + lazyLoad.batchSize,
        lazyLoad.totalCount
    );

    // Use setTimeout to allow UI to update before heavy rendering
    setTimeout(() => {
        // Append new items to DOM
        appendBatch(gridContainer, state.geometries, startIndex, endIndex, {
            isImported: lazyLoad.isImported
        });

        // Render the new batch
        renderGeometriesForBatch(startIndex, endIndex);

        // Setup hover preview listeners for new items
        setupPreviewListeners();

        // Update state
        lazyLoad.renderedCount = endIndex;
        lazyLoad.isLoading = false;
        lazyLoadingDiv.classList.add('hidden');

        console.log(`Loaded batch: ${startIndex}-${endIndex} of ${lazyLoad.totalCount}`);
    }, 50);
}

/**
 * Handle scroll for lazy loading and back-to-top button
 */
export function handleScroll() {
    const lazyLoad = state.lazyLoad;

    // Always check back-to-top button visibility (independent of lazy loading)
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    if (scrollTop > 600) { // Approximately 2 rows of items
        backToTopBtn.classList.remove('hidden');
    } else {
        backToTopBtn.classList.add('hidden');
    }

    // Only do lazy loading checks if enabled
    if (!lazyLoad.enabled) {
        return;
    }

    // Check if we should load more items
    if (lazyLoad.isLoading || lazyLoad.renderedCount >= lazyLoad.totalCount) {
        return;
    }

    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const distanceFromBottom = documentHeight - (scrollTop + windowHeight);

    if (distanceFromBottom < lazyLoad.loadThreshold) {
        loadMoreItems();
    }
}

/**
 * Handle back to top button click
 */
export function handleBackToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Setup lazy loading scroll listener and the back-to-top button
 */
export function setupLazyLoading() {
    // Throttle scroll events
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(handleScroll, 100);
    });

    backToTopBtn.addEventListener('click', handleBackToTop);
}

/**
 * Cleanup lazy loading (reset counters, hide elements)
 */
export function cleanupLazyLoading() {
    state.lazyLoad.enabled = false;
    state.lazyLoad.renderedCount = 0;
    state.lazyLoad.totalCount = 0;
    lazyLoadingDiv.classList.add('hidden');
    backToTopBtn.classList.add('hidden');
}
