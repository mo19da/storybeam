'use strict';

/**
 * Image provider.
 *
 * Priority:
 *   1. Runware AI        (custom illustration from story prompt — best quality)
 *   2. Local disk cache  (instant, free, served via /image-cache/)
 *   3. Pixabay API       (free stock photo fallback)
 *   4. Picsum Photos     (zero-config last resort)
 *
 * Set RUNWARE_API_KEY in env to enable Runware (recommended).
 * Set RUNWARE_MODEL to override the model (default: runware:100@1 = FLUX.1 schnell).
 */

const fs   = require('fs');
const path = require('path');
const { extractKeyword } = require('../data/kidKeywords');
const { generateRunwareImage } = require('./runwareImage');
const { log } = require('../utils/logger');

const CACHE_DIR  = process.env.IMAGE_CACHE_DIR  || path.join(__dirname, '../cache/images');
const INDEX_FILE = process.env.IMAGE_INDEX_FILE || path.join(__dirname, '../cache/imageIndex.json');
const VARIATIONS = 3;   // keep 3 variations per keyword (saves disk space)

// ─── Disk cache helpers ────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadIndex() {
  if (fs.existsSync(INDEX_FILE)) {
    try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (_) {}
  }
  return {};
}

function saveIndex(index) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

/** Return a local URL for a cached image, or null if not cached. */
function getCachedUrl(keyword) {
  const index = loadIndex();
  const files  = index[keyword];
  if (!files || files.length === 0) return null;
  // Pick a random variation
  const file = files[Math.floor(Math.random() * files.length)];
  return `/image-cache/${file}`;
}

/** Download a remote image URL to disk, return the local filename. */
async function downloadToCache(remoteUrl, keyword, varIdx) {
  ensureCacheDir();
  const ext      = '.jpg';
  const filename = `${keyword.replace(/\W/g, '_')}_${varIdx}${ext}`;
  const destPath = path.join(CACHE_DIR, filename);

  const res = await fetch(remoteUrl, { headers: { 'User-Agent': 'StoryBeam/1.0' } });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return filename;
}

// ─── Pixabay ───────────────────────────────────────────────────────────────────

/**
 * Search Pixabay and download up to `count` images for a keyword.
 * Requires PIXABAY_API_KEY in env. Uses safesearch=true for kids.
 * Returns array of local filenames.
 */
async function fetchFromPixabay(keyword, searchQuery, count = VARIATIONS) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];

  const url = `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(searchQuery)}&image_type=photo&safesearch=true&per_page=${count}&orientation=horizontal&min_width=400`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'StoryBeam/1.0' },
  });
  if (!res.ok) {
    console.warn(`[image] Pixabay returned ${res.status} for "${searchQuery}"`);
    return [];
  }
  const data = await res.json();
  if (!data.hits || data.hits.length === 0) {
    console.warn(`[image] Pixabay: no results for "${searchQuery}"`);
    return [];
  }

  const filenames = [];
  for (let i = 0; i < data.hits.length; i++) {
    try {
      const imgUrl  = data.hits[i].webformatURL; // ~640px, free tier
      const filename = await downloadToCache(imgUrl, keyword, i);
      filenames.push(filename);
    } catch (err) {
      console.warn(`[image] Pixabay download ${i} failed:`, err.message);
    }
  }
  return filenames;
}

// ─── Picsum fallback (no key needed) ──────────────────────────────────────────

/**
 * Picsum Photos — deterministic per seed, no API key.
 * Downloads and caches locally so subsequent calls are instant.
 */
async function fetchFromPicsum(keyword) {
  ensureCacheDir();
  const filenames = [];
  // Use keyword + index as seed → same keyword always returns same images
  for (let i = 0; i < VARIATIONS; i++) {
    const seed    = encodeURIComponent(`${keyword}${i}`);
    const imgUrl  = `https://picsum.photos/seed/${seed}/800/600`;
    try {
      const filename = await downloadToCache(imgUrl, `picsum_${keyword}`, i);
      filenames.push(filename);
    } catch (err) {
      console.warn(`[image] Picsum download ${i} failed:`, err.message);
    }
  }
  return filenames;
}

// ─── Main fetch-and-cache ─────────────────────────────────────────────────────

/**
 * Ensure `count` images are cached for `keyword`.
 * Uses Unsplash if key available, otherwise Picsum.
 * Saves new files to index.
 * Returns array of local filenames.
 */
async function ensureCached(keyword, searchQuery) {
  const index    = loadIndex();
  const existing = index[keyword] || [];
  if (existing.length >= VARIATIONS) return existing;

  console.log(`[image] Fetching images for keyword "${keyword}"…`);

  let filenames = await fetchFromPixabay(keyword, searchQuery);
  if (filenames.length === 0) {
    console.log(`[image] Pixabay empty/unavailable — using Picsum for "${keyword}"`);
    filenames = await fetchFromPicsum(keyword);
  }

  if (filenames.length > 0) {
    index[keyword] = filenames;
    saveIndex(index);
  }
  return filenames;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get an image URL for a story segment. Always returns immediately:
 * - local cache URL if available
 * - fetches + caches in background if not, then returns result
 * On any failure returns null (frontend shows placeholder).
 */
async function generateImage(imagePrompt, segmentIndex, sessionId, childAge, theme, heroName) {
  const startTime = Date.now();

  if (process.env.DISABLE_IMAGES === 'true') {
    return { imageUrl: null, segmentIndex };
  }

  // ── 1. Runware: custom illustration from the actual story prompt ──────────────
  if (process.env.RUNWARE_API_KEY) {
    try {
      const remoteUrl = await generateRunwareImage(imagePrompt || '', childAge);
      if (remoteUrl) {
        const latencyMs = Date.now() - startTime;
        log({ event: 'image_generated', sessionId, childAge, theme, latencyMs, success: true, source: 'runware' });
        console.log(`[image] Runware OK — seg=${segmentIndex} ${latencyMs}ms`);
        return { imageUrl: remoteUrl, segmentIndex };
      }
    } catch (err) {
      console.warn(`[image] Runware failed (falling back to Pixabay): ${err.message}`);
    }
  }

  // ── 2. Pixabay / Picsum fallback ──────────────────────────────────────────────
  const { keyword, searchQuery } = extractKeyword(imagePrompt || '', theme || 'animals', heroName || null);

  try {
    let localUrl = getCachedUrl(keyword);
    if (!localUrl) {
      const files = await ensureCached(keyword, searchQuery);
      if (files.length > 0) {
        const file = files[Math.floor(Math.random() * files.length)];
        localUrl = `/image-cache/${file}`;
      }
    }

    const latencyMs = Date.now() - startTime;
    if (localUrl) {
      log({ event: 'image_generated', sessionId, childAge, theme, latencyMs, success: true, source: 'pixabay' });
      console.log(`[image] Pixabay/cache — seg=${segmentIndex} keyword="${keyword}" ${latencyMs}ms`);
      return { imageUrl: localUrl, segmentIndex };
    }

    log({ event: 'image_generated', sessionId, childAge, theme, latencyMs, success: false, errorMessage: 'No images available' });
    return { imageUrl: null, segmentIndex };

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    log({ event: 'image_generated', sessionId, childAge, theme, latencyMs, success: false, errorMessage: err.message });
    console.error(`[image] Pixabay also failed for "${keyword}":`, err.message);
    return { imageUrl: null, segmentIndex };
  }
}

module.exports = { generateImage, ensureCached, loadIndex };
