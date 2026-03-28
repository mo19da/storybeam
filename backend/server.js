'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { generateStory, customizeStory } = require('./pipeline/storyGenerator');
const storyLibrary = require('./data/storyLibrary');
const { transcribeAudio } = require('./pipeline/speechToText');
const { synthesizeSpeech } = require('./pipeline/textToSpeech');
const { generateImage } = require('./pipeline/imageGenerator');
const { sanitizeInput, validateTheme, validateAge } = require('./middleware/safetyFilter');
const { storyLimiter, transcribeLimiter, generalLimiter } = require('./middleware/rateLimiter');
const { log } = require('./utils/logger');

// ─── App setup ─────────────────────────────────────────────────────────────────

const app = express();

app.use(helmet({
  // Relax CSP so the frontend can load Google Fonts and DALL-E image URLs
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '512kb' }));
app.use(generalLimiter);

// Serve frontend from ../frontend (relative to backend/)
app.use(express.static(path.join(__dirname, '../frontend')));
// Serve locally-cached images (Pixabay/Picsum downloads) at zero runtime cost
app.use('/image-cache', express.static(path.join(__dirname, 'cache/images')));

// Multer — audio uploads in memory, max 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ─── Generate story ────────────────────────────────────────────────────────────

app.post('/api/generate-story', storyLimiter, async (req, res) => {
  const { childName, age, theme, heroName } = req.body;
  const sessionId = uuidv4();

  if (!childName || childName.trim().length === 0) {
    return res.status(400).json({ error: 'Child name is required' });
  }

  const validatedAge = validateAge(age);
  if (validatedAge === null) {
    return res.status(400).json({ error: 'Age must be between 2 and 8' });
  }

  const validatedTheme = validateTheme(theme);
  const cleanName = childName.trim().slice(0, 30);
  const cleanHero = heroName ? heroName.trim().slice(0, 50) : null;

  try {
    const result = await withTimeout(
      generateStory({ childName: cleanName, age: validatedAge, theme: validatedTheme, heroName: cleanHero }, sessionId),
      20000,
      'Story generation timed out'
    );
    res.json({ ...result, sessionId });
  } catch (err) {
    logAndRespond500(err, res, sessionId, validatedAge, validatedTheme, 'story_generated');
  }
});

// ─── Customize story ───────────────────────────────────────────────────────────

app.post('/api/customize-story', storyLimiter, async (req, res) => {
  const {
    childName, age, storyTitle, storyState,
    customization, currentSegmentIndex,
    sessionId: existingSessionId,
  } = req.body;

  const sessionId = existingSessionId || uuidv4();

  const validatedAge = validateAge(age);
  if (validatedAge === null) {
    return res.status(400).json({ error: 'Invalid age' });
  }

  if (!storyState || typeof storyState !== 'object') {
    return res.status(400).json({ error: 'storyState is required' });
  }

  // Sanitize child's spoken customization
  const { text: sanitizedCustomization, filtered, original } = sanitizeInput(customization || '');

  if (filtered) {
    log({
      event: 'error',
      sessionId,
      childAge: validatedAge,
      theme: storyState.theme,
      latencyMs: 0,
      success: true, // filtered successfully — not a failure
      errorMessage: `Content filtered: "${String(original).slice(0, 60)}"`,
    });
  }

  const finalCustomization = sanitizedCustomization || 'something fun';

  try {
    const result = await withTimeout(
      customizeStory({
        childName: (childName || storyState.childName || '').trim().slice(0, 30),
        age: validatedAge,
        storyTitle: storyTitle || storyState.title || 'Our Story',
        storyState,
        customization: finalCustomization,
        currentSegmentIndex: currentSegmentIndex || 0,
      }, sessionId),
      20000,
      'Customization timed out'
    );
    res.json({ ...result, sessionId });
  } catch (err) {
    logAndRespond500(err, res, sessionId, validatedAge, storyState.theme, 'customization');
  }
});

// ─── Transcribe audio ──────────────────────────────────────────────────────────

app.post('/api/transcribe', transcribeLimiter, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ transcript: null, error: 'No audio file provided' });
  }

  const sessionId = req.body?.sessionId || uuidv4();
  const childAge = validateAge(req.body?.childAge) || 5;

  try {
    const result = await transcribeAudio(req.file.buffer, sessionId, childAge);
    res.json(result);
  } catch (err) {
    console.error('[server] Transcribe error:', err.message);
    res.json({ transcript: null, error: 'Could not hear that', latencyMs: 0 });
  }
});

// ─── Synthesize speech ────────────────────────────────────────────────────────

app.post('/api/synthesize', async (req, res) => {
  const { text, age, sessionId } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const validatedAge = validateAge(age) || 5;
  const sid = sessionId || uuidv4();

  try {
    await synthesizeSpeech(text.trim().slice(0, 500), validatedAge, res, sid);
  } catch (err) {
    console.error('[server] TTS error:', err.message);
    log({ event: 'error', sessionId: sid, childAge: validatedAge, latencyMs: 0, success: false, errorMessage: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'tts_failed' });
    }
  }
});

// ─── Generate image ───────────────────────────────────────────────────────────

app.post('/api/generate-image', async (req, res) => {
  const { imagePrompt, segmentIndex, sessionId, childAge, theme, heroName } = req.body;

  if (!imagePrompt) {
    return res.json({ imageUrl: null, segmentIndex: segmentIndex ?? 0 });
  }

  const sid = sessionId || uuidv4();
  const age = validateAge(childAge) || 5;
  const validTheme = validateTheme(theme);
  const cleanHero = heroName ? heroName.trim().slice(0, 50) : null;

  try {
    const result = await generateImage(imagePrompt, segmentIndex ?? 0, sid, age, validTheme, cleanHero);
    res.json(result);
  } catch (err) {
    console.error('[server] Image error:', err.message);
    res.json({ imageUrl: null, segmentIndex: segmentIndex ?? 0 });
  }
});

// ─── Story library stats ──────────────────────────────────────────────────────

app.get('/api/story-library', (_req, res) => {
  res.json(storyLibrary.getStats());
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────

app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function logAndRespond500(err, res, sessionId, childAge, theme, event) {
  console.error(`[server] ${event} error:`, err.message);
  log({ event: 'error', sessionId, childAge, theme, latencyMs: 0, success: false, errorMessage: err.message });
  if (!res.headersSent) {
    res.status(500).json({ error: 'The story fairies are busy — tap to try again' });
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`\n✨ StoryBeam is running at http://localhost:${PORT}\n`);
});
