'use strict';

/**
 * Story generation via OpenAI GPT-4o-mini.
 * Swap STORY_MODEL=gpt-4o for higher quality.
 * Switch to Claude once Anthropic subscription is available — just swap the client here.
 */

const OpenAI = require('openai');
const { validateClaudeResponse } = require('../middleware/safetyFilter');
const { log } = require('../utils/logger');
const storyLibrary = require('../data/storyLibrary');

const STORY_MODEL = process.env.STORY_MODEL || 'gpt-4o-mini';

let _openai = null;
function getClient() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── Age guidance ──────────────────────────────────────────────────────────────

function getAgeGuidance(age) {
  if (age <= 3) return 'Age 2-3: MAXIMUM 2 short sentences per segment. Use only simple toddler words. Add fun sounds like whoosh, boing, splish-splash. Very slow, gentle pacing.';
  if (age <= 5) return 'Age 4-5: 2-3 short sentences per segment. Playful vocabulary. Clear simple emotions. Cause-and-effect actions.';
  return 'Age 6-8: 3 sentences per segment. Richer descriptions. Slightly more complex plot. All tension resolves happily.';
}

// ─── storyState schema example ────────────────────────────────────────────────
// Used in prompts so the model understands the exact structure required.

function stateSchema(childName, age, theme, heroName) {
  return {
    title: 'The Story Title',
    childName,
    age,
    theme,
    heroName: heroName || null,
    characters: [heroName || childName],
    setting: 'describe where the story takes place',
    mood: 'joyful',
    segmentsCompleted: 0,
    keyEvents: [],
    customizationsApplied: [],
  };
}

// ─── Prompts ───────────────────────────────────────────────────────────────────

function buildSystemPrompt(childName, age, theme, heroName) {
  return `You are a warm, joyful children's story writer. You always return ONLY valid JSON — no markdown, no explanation, nothing else.

AGE RULES (follow strictly):
${getAgeGuidance(age)}

HARD RULES:
- No scary content, violence, or sad endings
- No character dies, gets hurt, or is lost forever
- Always end on a happy, warm, resolved note
- Keep ALL names/settings consistent with storyState

REQUIRED JSON SHAPE — you must return exactly this structure:

For generate-story, return:
{
  "title": "Story Title Here",
  "segments": [
    { "text": "Story text for this segment.", "imagePrompt": "Vivid scene: who + action + where + mood + lighting" }
  ],
  "storyState": ${JSON.stringify(stateSchema(childName, age, theme, heroName), null, 2)}
}
segments must have EXACTLY 6 objects.

For customize-story, return:
{
  "segments": [
    { "text": "Story text.", "imagePrompt": "Vivid scene description." }
  ],
  "storyState": { ...same storyState shape above with all fields filled in... }
}
segments must have EXACTLY 2 objects.

storyState.mood must be one of: joyful, adventurous, cozy, curious
storyState.keyEvents: brief list of what happened, max 5 items
All storyState fields are required — never omit any.`;
}

// ─── JSON helpers ──────────────────────────────────────────────────────────────

function extractJSON(text) {
  try { return JSON.parse(text); } catch (_) {}
  const stripped = text.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/im, '').trim();
  try { return JSON.parse(stripped); } catch (_) {}
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch (_) {}
  }
  throw new Error('No valid JSON in model response');
}

// Fill in any storyState fields the model left blank/empty so validation passes.
function normalizeStoryState(state, { childName, age, theme, heroName, title }) {
  if (!state || typeof state !== 'object') {
    return stateSchema(childName, age, theme, heroName);
  }
  const MOODS = ['joyful', 'adventurous', 'cozy', 'curious'];
  return {
    title:                 state.title                 || title || '',
    childName:             state.childName             || childName,
    age:                   typeof state.age === 'number' ? state.age : age,
    theme:                 state.theme                 || theme,
    heroName:              state.heroName              ?? heroName ?? null,
    characters:            Array.isArray(state.characters) ? state.characters : [heroName || childName],
    setting:               state.setting               || 'a magical place',
    mood:                  MOODS.includes(state.mood)  ? state.mood : 'joyful',
    segmentsCompleted:     typeof state.segmentsCompleted === 'number' ? state.segmentsCompleted : 0,
    keyEvents:             Array.isArray(state.keyEvents) ? state.keyEvents.slice(-5) : [],
    customizationsApplied: Array.isArray(state.customizationsApplied) ? state.customizationsApplied : [],
  };
}

// ─── generateStory ─────────────────────────────────────────────────────────────

async function generateStory({ childName, age, theme, heroName }, sessionId) {
  // ── Library check: reuse an existing story, just swap the name ──────────────
  const cached = storyLibrary.findStory(theme, age, heroName);
  if (cached) {
    storyLibrary.incrementUsed(cached.id);
    const result = storyLibrary.materializeStory(cached, childName);
    console.log(`[story] Library HIT — id=${cached.id} used=${cached.used_count + 1}x (${theme}/${age})`);
    log({ event: 'story_generated', sessionId, childAge: age, theme, latencyMs: 0, success: true, fromCache: true });
    return result;
  }

  console.log(`[story] Library MISS — generating new story (${theme}/${age}/hero=${heroName || 'none'})`);
  const startTime = Date.now();

  const systemPrompt = buildSystemPrompt(childName, age, theme, heroName);
  const userPrompt =
    `Write a 6-segment children's story in JSON for ${childName}, age ${age}, theme: ${theme}, hero: ${heroName || childName}.` +
    ` Make it warm, age-appropriate, with a clear beginning → middle → happy ending.` +
    ` Return ONLY the JSON object described in the system prompt.`;

  let lastError = null;
  let inputTokens = null;
  let outputTokens = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await getClient().chat.completions.create({
        model: STORY_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 2800,
        temperature: 0.85,
        response_format: { type: 'json_object' },
      });

      inputTokens  = response.usage?.prompt_tokens     ?? null;
      outputTokens = response.usage?.completion_tokens ?? null;

      const raw    = response.choices[0].message.content;
      const parsed = extractJSON(raw);

      // Normalise storyState before validation so empty fields don't break it
      parsed.storyState = normalizeStoryState(parsed.storyState, { childName, age, theme, heroName, title: parsed.title });

      const { valid, error } = validateClaudeResponse(parsed, 'generate');
      if (!valid) {
        lastError = new Error(`Validation (attempt ${attempt + 1}): ${error}`);
        console.error('[story] Validation failed:', lastError.message);
        console.error('[story] segments count:', parsed.segments?.length, 'storyState:', JSON.stringify(parsed.storyState));
        if (attempt === 0) await sleep(800);
        continue;
      }

      const latencyMs = Date.now() - startTime;
      log({ event: 'story_generated', sessionId, childAge: age, theme, inputTokens, outputTokens, latencyMs, success: true });
      console.log(`[story] generate OK — ${latencyMs}ms  model=${STORY_MODEL}  in=${inputTokens} out=${outputTokens}`);

      // Save to library so future children with same theme/age get this story free
      try {
        storyLibrary.saveStory({
          title: parsed.title, segments: parsed.segments, storyState: parsed.storyState,
          theme, childName, age, heroName,
        });
      } catch (libErr) {
        console.warn('[story] Library save failed (non-fatal):', libErr.message);
      }

      return parsed;

    } catch (err) {
      lastError = err;
      console.error(`[story] Attempt ${attempt + 1} error:`, err.message);
      if (attempt === 0) await sleep(800);
    }
  }

  const latencyMs = Date.now() - startTime;
  log({ event: 'story_generated', sessionId, childAge: age, theme, inputTokens, outputTokens, latencyMs, success: false, errorMessage: lastError?.message });
  throw lastError;
}

// ─── customizeStory ────────────────────────────────────────────────────────────

async function customizeStory({ childName, age, storyTitle, storyState, customization, currentSegmentIndex }, sessionId) {
  const startTime = Date.now();

  const systemPrompt = buildSystemPrompt(childName, age, storyState?.theme || 'animals', storyState?.heroName);
  const userPrompt =
    `Continue the story by weaving in the child's idea in a simple, fun way. Return ONLY the JSON.\n\n` +
    `Story: "${storyTitle}" | Current segment: ${currentSegmentIndex}\n` +
    `Child said: "${customization}"\n` +
    `Story so far: theme=${storyState?.theme}, setting=${storyState?.setting || 'magical place'}, characters=${(storyState?.characters || []).join(', ')}\n\n` +
    `Generate EXACTLY 2 new story segments that naturally include what the child mentioned. Keep it short and fun.`;

  let lastError = null;
  let inputTokens = null;
  let outputTokens = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await getClient().chat.completions.create({
        model: STORY_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 900,
        temperature: 0.85,
        response_format: { type: 'json_object' },
      });

      inputTokens  = response.usage?.prompt_tokens     ?? null;
      outputTokens = response.usage?.completion_tokens ?? null;

      const parsed = extractJSON(response.choices[0].message.content);
      parsed.storyState = normalizeStoryState(parsed.storyState, {
        childName, age,
        theme:    storyState?.theme    || 'animals',
        heroName: storyState?.heroName || null,
        title:    storyTitle,
      });

      const { valid, error } = validateClaudeResponse(parsed, 'customize');
      if (!valid) {
        lastError = new Error(`Validation (attempt ${attempt + 1}): ${error}`);
        console.error('[story] Customize validation failed:', lastError.message);
        if (attempt === 0) await sleep(800);
        continue;
      }

      const latencyMs = Date.now() - startTime;
      log({ event: 'customization', sessionId, childAge: age, theme: storyState?.theme, inputTokens, outputTokens, latencyMs, success: true });
      console.log(`[story] customize OK — ${latencyMs}ms  in=${inputTokens} out=${outputTokens}`);
      return parsed;

    } catch (err) {
      lastError = err;
      console.error(`[story] Customize attempt ${attempt + 1}:`, err.message);
      if (attempt === 0) await sleep(800);
    }
  }

  const latencyMs = Date.now() - startTime;
  log({ event: 'customization', sessionId, childAge: age, theme: storyState?.theme, inputTokens, outputTokens, latencyMs, success: false, errorMessage: lastError?.message });
  throw lastError;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { generateStory, customizeStory };
