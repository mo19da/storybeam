'use strict';

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { log } = require('../utils/logger');

let _openai = null;
function getClient() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const CACHE_DIR = path.join(
  process.env.TTS_CACHE_DIR || path.join(require('os').tmpdir(), 'tts_cache')
);

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getVoiceSettings(age) {
  const voice = age <= 5 ? 'nova' : 'shimmer';
  let speed;
  if (age <= 3) speed = 0.82;
  else if (age <= 5) speed = 0.90;
  else speed = 0.96;
  return { voice, speed };
}

function cachePath(text, voice, speed) {
  const key = crypto.createHash('sha256').update(`${text}::${voice}::${speed}`).digest('hex');
  return path.join(CACHE_DIR, `${key}.mp3`);
}

/**
 * Synthesize speech and pipe audio/mpeg directly to an Express response.
 * Caches results to /tmp/tts_cache — reuses on repeat calls.
 */
async function synthesizeSpeech(text, age, res, sessionId) {
  const startTime = Date.now();
  const { voice, speed } = getVoiceSettings(age);
  const filePath = cachePath(text, voice, speed);

  ensureCacheDir();

  // ── Cache hit ──────────────────────────────────────────────────────────────
  if (fs.existsSync(filePath)) {
    const latencyMs = Date.now() - startTime;
    log({ event: 'tts', sessionId, childAge: age, latencyMs, success: true });
    console.log(`[tts] Cache HIT — ${latencyMs}ms (voice=${voice} speed=${speed})`);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Latency-Ms', String(latencyMs));
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // ── API call ───────────────────────────────────────────────────────────────
  try {
    const openai = getClient();
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1-hd',   // upgraded — cost offset by story library cache hits
      voice,
      input: text,
      speed,
      response_format: 'mp3',
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    const latencyMs = Date.now() - startTime;

    log({ event: 'tts', sessionId, childAge: age, latencyMs, success: true });
    console.log(`[tts] Generated — ${latencyMs}ms (voice=${voice} speed=${speed} ${buffer.length}B)`);

    // Write cache async — don't block response
    fs.writeFile(filePath, buffer, (err) => {
      if (err) console.error('[tts] Cache write failed:', err.message);
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Latency-Ms', String(latencyMs));
    res.send(buffer);

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    log({ event: 'tts', sessionId, childAge: age, latencyMs, success: false, errorMessage: err.message });
    console.error('[tts] Synthesis failed:', err.message);
    throw err;
  }
}

module.exports = { synthesizeSpeech };
