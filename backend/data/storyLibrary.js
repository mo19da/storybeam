'use strict';

/**
 * Story Library — SQLite-backed template store.
 *
 * Stories are saved with {NAME} in place of the child's name so they can be
 * reused for any child.  On retrieval we swap {NAME} back in, avoiding the
 * LLM call entirely (the expensive part).
 *
 * DB lives at:  backend/cache/stories.db
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');

// Allow overriding via env so cloud hosts with persistent volumes can point here
const DB_PATH = process.env.STORIES_DB_PATH || path.join(__dirname, '../cache/stories.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  // Ensure the directory exists (needed on cloud hosts where /data volume may not be pre-created)
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');   // safe concurrent reads
  _db.exec(`
    CREATE TABLE IF NOT EXISTS story_templates (
      id                  TEXT    PRIMARY KEY,
      theme               TEXT    NOT NULL,
      age_group           TEXT    NOT NULL,
      hero_type           TEXT,
      title_template      TEXT    NOT NULL,
      segments_json       TEXT    NOT NULL,
      state_template_json TEXT    NOT NULL,
      created_at          INTEGER NOT NULL,
      used_count          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_theme_age ON story_templates (theme, age_group);
  `);
  return _db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ageToGroup(age) {
  if (age <= 3) return '2-3';
  if (age <= 5) return '4-5';
  return '6-8';
}

/** "a brave dragon" → "dragon", "Luna the bunny" → "bunny" */
function normalizeHero(heroName) {
  if (!heroName) return null;
  return heroName.toLowerCase().trim().split(/\s+/).pop();
}

/**
 * Replace all word-boundary occurrences of childName with {NAME}.
 * Uses \b so "Ana" doesn't corrupt "fantastic".
 */
function templatize(text, childName) {
  if (!text || !childName) return text;
  const escaped = childName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '{NAME}');
}

/** Replace {NAME} with the actual child name. */
function personalize(text, childName) {
  if (!text || !childName) return text;
  return text.replace(/\{NAME\}/g, childName);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Save a freshly generated story to the library.
 * Strips the child's name out, replacing it with {NAME}.
 */
function saveStory({ title, segments, storyState, theme, childName, age, heroName }) {
  const db        = getDb();
  const ageGroup  = ageToGroup(age);
  const heroType  = normalizeHero(heroName || storyState?.heroName);

  const titleTemplate    = templatize(title, childName);
  const segmentsTemplate = segments.map(seg => ({
    text_template: templatize(seg.text, childName),
    imagePrompt:   seg.imagePrompt,          // image prompts don't need the name
  }));
  // Templatize the whole state blob via JSON round-trip
  const stateTemplate = JSON.parse(templatize(JSON.stringify(storyState), childName));

  const id = uuidv4();
  db.prepare(`
    INSERT INTO story_templates
      (id, theme, age_group, hero_type, title_template, segments_json, state_template_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, theme, ageGroup, heroType,
    titleTemplate,
    JSON.stringify(segmentsTemplate),
    JSON.stringify(stateTemplate),
    Date.now()
  );

  console.log(`[library] Saved "${titleTemplate}" — ${theme}/${ageGroup}/hero=${heroType}`);
  return id;
}

/**
 * Find a random matching story template.
 * First tries theme + age_group + hero_type, then loosens to theme + age_group.
 * Returns the raw DB row, or null if the library is empty for this combo.
 */
function findStory(theme, age, heroName) {
  const db       = getDb();
  const ageGroup = ageToGroup(age);
  const heroType = normalizeHero(heroName);

  if (heroType) {
    const row = db.prepare(`
      SELECT * FROM story_templates
      WHERE theme = ? AND age_group = ? AND hero_type = ?
      ORDER BY RANDOM() LIMIT 1
    `).get(theme, ageGroup, heroType);
    if (row) return row;
  }

  return db.prepare(`
    SELECT * FROM story_templates
    WHERE theme = ? AND age_group = ?
    ORDER BY RANDOM() LIMIT 1
  `).get(theme, ageGroup) || null;
}

/**
 * Turn a library row into a story object ready to send to the frontend,
 * with {NAME} replaced by the actual child's name.
 */
function materializeStory(row, childName) {
  const segments = JSON.parse(row.segments_json).map(seg => ({
    text:        personalize(seg.text_template, childName),
    imagePrompt: seg.imagePrompt,
  }));

  const rawState  = JSON.parse(row.state_template_json);
  const stateJson = personalize(JSON.stringify(rawState), childName);
  const storyState = JSON.parse(stateJson);
  storyState.childName = childName;   // always authoritative

  return {
    title:      personalize(row.title_template, childName),
    segments,
    storyState,
  };
}

/** Increment the use counter for analytics. */
function incrementUsed(id) {
  getDb().prepare(
    `UPDATE story_templates SET used_count = used_count + 1 WHERE id = ?`
  ).run(id);
}

/** Simple stats for the /api/story-library endpoint. */
function getStats() {
  const db   = getDb();
  const rows = db.prepare(`
    SELECT theme, age_group, COUNT(*) AS count, SUM(used_count) AS total_uses
    FROM story_templates GROUP BY theme, age_group ORDER BY theme, age_group
  `).all();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM story_templates`).get();
  return { total: total.n, breakdown: rows };
}

module.exports = { saveStory, findStory, materializeStory, incrementUsed, getStats };
