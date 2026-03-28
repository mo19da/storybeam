'use strict';

const { validateState } = require('../utils/stateManager');

// Keep these minimal — the goal is to catch obvious problems, not build a keyword firewall
const BAD_WORDS = [
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'piss', 'bastard', 'hell',
  'kill', 'murder', 'death', 'die', 'dying', 'dead', 'blood', 'gore',
  'weapon', 'gun', 'knife', 'bomb', 'shoot', 'stab',
  'sex', 'naked', 'nude', 'porn',
  'drug', 'weed', 'cocaine', 'alcohol', 'drunk',
];

const ALLOWED_THEMES = ['animals', 'castles', 'space', 'magic', 'dinosaurs', 'ocean'];

/**
 * Sanitize a short child customization input.
 * Returns { text, filtered, original }
 */
function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'string') {
    return { text: 'something fun', filtered: false, original: raw };
  }

  // Hard length cap — kids say short things
  const trimmed = raw.trim().slice(0, 200);

  const lower = trimmed.toLowerCase();
  for (const word of BAD_WORDS) {
    // Simple word-boundary-ish check (check for word within string)
    if (lower.includes(word)) {
      return { text: 'something fun', filtered: true, original: raw };
    }
  }

  return { text: trimmed, filtered: false, original: raw };
}

/**
 * Validate segments array from Claude.
 */
function validateSegments(segments, expectedCount) {
  if (!Array.isArray(segments)) return false;
  if (segments.length !== expectedCount) return false;
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') return false;
    if (!seg.text || typeof seg.text !== 'string') return false;
    if (seg.text.trim().length === 0) return false;
    if (seg.text.length > 400) return false;
    if (!seg.imagePrompt || typeof seg.imagePrompt !== 'string') return false;
    if (seg.imagePrompt.trim().length === 0) return false;
  }
  return true;
}

/**
 * Validate the full Claude response object.
 * type: 'generate' (expects 6 segments + title) | 'customize' (expects 3 segments)
 */
function validateClaudeResponse(data, type) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Response is not an object' };
  }

  const expectedCount = type === 'generate' ? 6 : 3;

  if (!validateSegments(data.segments, expectedCount)) {
    return {
      valid: false,
      error: `segments invalid — expected ${expectedCount} non-empty items under 400 chars each`,
    };
  }

  if (!data.storyState || !validateState(data.storyState)) {
    return { valid: false, error: 'storyState missing or invalid' };
  }

  if (type === 'generate' && (!data.title || typeof data.title !== 'string')) {
    return { valid: false, error: 'title missing for generate response' };
  }

  return { valid: true };
}

/**
 * Validate and normalise the theme key sent from the frontend.
 */
function validateTheme(theme) {
  if (!theme || !ALLOWED_THEMES.includes(theme.toLowerCase())) return 'animals';
  return theme.toLowerCase();
}

/**
 * Validate age — must be integer 2–8.
 */
function validateAge(age) {
  const n = parseInt(age, 10);
  if (isNaN(n) || n < 2 || n > 8) return null;
  return n;
}

module.exports = {
  sanitizeInput,
  validateClaudeResponse,
  validateTheme,
  validateAge,
  ALLOWED_THEMES,
};
