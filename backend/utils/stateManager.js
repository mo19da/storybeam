'use strict';

/**
 * Build a fresh storyState object for a new story.
 */
function createInitialState({ childName, age, theme, heroName, title = '' }) {
  return {
    title,
    childName,
    age,
    theme,
    heroName: heroName || null,
    characters: heroName ? [heroName] : [childName],
    setting: '',
    mood: 'joyful',
    segmentsCompleted: 0,
    keyEvents: [],
    customizationsApplied: [],
  };
}

/**
 * Validate that a storyState object has all required fields.
 */
function validateState(state) {
  if (!state || typeof state !== 'object') return false;
  const required = [
    'title', 'childName', 'age', 'theme',
    'characters', 'setting', 'mood',
    'segmentsCompleted', 'keyEvents', 'customizationsApplied',
  ];
  for (const field of required) {
    if (state[field] === undefined) return false;
  }
  if (!Array.isArray(state.characters)) return false;
  if (!Array.isArray(state.keyEvents)) return false;
  if (!Array.isArray(state.customizationsApplied)) return false;
  return true;
}

/**
 * Merge an updated storyState from Claude into the existing one,
 * keeping keyEvents trimmed to the 5 most recent.
 */
function mergeState(existing, updated) {
  const merged = { ...existing, ...updated };
  if (Array.isArray(merged.keyEvents) && merged.keyEvents.length > 5) {
    merged.keyEvents = merged.keyEvents.slice(-5);
  }
  return merged;
}

module.exports = { createInitialState, validateState, mergeState };
