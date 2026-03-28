'use strict';

const { createClient } = require('@deepgram/sdk');
const { log } = require('../utils/logger');

// Lazy-init so missing key is caught at runtime, not module load
let _deepgram = null;
function getClient() {
  if (!_deepgram) _deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  return _deepgram;
}

/**
 * Transcribe an audio Buffer (WebM/Opus from MediaRecorder).
 * Returns { transcript, confidence, latencyMs } or { transcript: null, error, latencyMs }
 */
async function transcribeAudio(audioBuffer, sessionId, childAge) {
  const startTime = Date.now();

  try {
    const deepgram = getClient();

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: 'nova-2',
        language: 'en-US',
        punctuate: true,
        smart_format: true,
      }
    );

    if (error) throw new Error(error.message || 'Deepgram error');

    const latencyMs = Date.now() - startTime;
    const alt = result?.results?.channels?.[0]?.alternatives?.[0];
    const transcript = alt?.transcript?.trim() || '';
    const confidence = alt?.confidence ?? 0;

    log({ event: 'transcription', sessionId, childAge, latencyMs, success: true });
    console.log(`[stt] Transcribed in ${latencyMs}ms — "${transcript}" (conf=${confidence.toFixed(2)})`);

    return { transcript, confidence, latencyMs };

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    log({ event: 'transcription', sessionId, childAge, latencyMs, success: false, errorMessage: err.message });
    console.error('[stt] Transcription failed:', err.message);
    return { transcript: null, error: 'Could not hear that', latencyMs };
  }
}

module.exports = { transcribeAudio };
