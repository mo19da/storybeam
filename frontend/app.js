'use strict';

/* ============================================================
   StoryBeam — Frontend App
   ============================================================ */

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  sessionId:          null,
  childName:          '',
  age:                5,
  theme:              'animals',
  heroName:           '',
  storyTitle:         '',
  storyState:         null,
  segments:           [],         // { text, imagePrompt }[]
  currentIdx:         0,
  totalSegments:      0,
  images:             {},         // idx -> imageUrl
  audioBlobUrls:      {},         // idx -> object URL
  isPlaying:          false,
  isPaused:           false,
  isListening:        false,
  isProcessing:       false,
  currentAudio:       null,
  advanceTimer:       null,
  // Recording
  mediaRecorder:      null,
  audioChunks:        [],
  recordingStream:    null,
  silenceInterval:    null,
  maxRecordTimer:     null,
  audioContext:       null,
  analyser:           null,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
  setupScreen:        $('setup-screen'),
  loadingScreen:      $('loading-screen'),
  playerScreen:       $('player-screen'),
  form:               $('setup-form'),
  childName:          $('child-name'),
  agePills:           $('age-pills'),
  themeGrid:          $('theme-grid'),
  heroName:           $('hero-name'),
  btnBegin:           $('btn-begin'),
  loadingEmoji:       $('loading-emoji'),
  loadingMessage:     $('loading-message'),
  storyTitle:         $('story-title'),
  imageZone:          $('image-zone'),
  imagePlaceholder:   $('image-placeholder'),
  storyImage:         $('story-image'),
  progressDots:       $('progress-dots'),
  storyText:          $('story-text'),
  statusLine:         $('status-line'),
  micBtn:             $('mic-btn'),
  micLabel:           $('mic-label'),
  btnReplay:          $('btn-replay'),
  btnPause:           $('btn-pause'),
  btnSkip:            $('btn-skip'),
  btnHome:            $('btn-home'),
  listeningOverlay:   $('listening-overlay'),
  transcriptDisplay:  $('transcript-display'),
  btnNeverMind:       $('btn-never-mind'),
  doneOverlay:        $('done-overlay'),
  doneName:           $('done-name'),
  btnMoreStory:       $('btn-more-story'),
  btnNewStory:        $('btn-new-story'),
  toast:              $('toast'),
};

// ── Loading messages ──────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  { emoji: '✨', text: 'Weaving your story…' },
  { emoji: '🎨', text: 'Painting the pictures…' },
  { emoji: '🧚', text: 'Calling the story fairies…' },
  { emoji: '🌟', text: 'Sprinkling in some magic…' },
  { emoji: '📖', text: 'Opening the story book…' },
  { emoji: '🎵', text: 'Finding the perfect words…' },
];
let loadingMsgIdx = 0;
let loadingMsgTimer = null;

function startLoadingMessages() {
  loadingMsgIdx = 0;
  setLoadingMsg(LOADING_MESSAGES[0]);
  loadingMsgTimer = setInterval(() => {
    loadingMsgIdx = (loadingMsgIdx + 1) % LOADING_MESSAGES.length;
    setLoadingMsg(LOADING_MESSAGES[loadingMsgIdx]);
  }, 2200);
}

function stopLoadingMessages() {
  clearInterval(loadingMsgTimer);
}

function setLoadingMsg({ emoji, text }) {
  dom.loadingEmoji.textContent = emoji;
  dom.loadingMessage.style.opacity = '0';
  setTimeout(() => {
    dom.loadingMessage.textContent = text;
    dom.loadingMessage.style.opacity = '1';
  }, 200);
}

// ── Screen management ─────────────────────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screens = {
    setup:   dom.setupScreen,
    loading: dom.loadingScreen,
    player:  dom.playerScreen,
  };
  if (screens[name]) screens[name].classList.add('active');
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(message, duration = 3500) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.style.display = 'block';
  toastTimer = setTimeout(() => { dom.toast.style.display = 'none'; }, duration);
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiGenerateStory({ childName, age, theme, heroName }) {
  return apiPost('/api/generate-story', { childName, age, theme, heroName });
}

async function apiCustomizeStory({ childName, age, storyTitle, storyState, customization, currentSegmentIndex, sessionId }) {
  return apiPost('/api/customize-story', { childName, age, storyTitle, storyState, customization, currentSegmentIndex, sessionId });
}

async function apiTranscribe(audioBlob, sessionId, childAge) {
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  form.append('sessionId', sessionId || '');
  form.append('childAge', String(childAge));

  const res = await fetch('/api/transcribe', { method: 'POST', body: form });
  if (!res.ok) return { transcript: null, error: 'Transcription failed' };
  return res.json();
}

async function apiGenerateImage({ imagePrompt, segmentIndex, sessionId, childAge, theme, heroName }) {
  return apiPost('/api/generate-image', { imagePrompt, segmentIndex, sessionId, childAge, theme, heroName });
}

// Synthesize — returns an object URL for an audio/mpeg blob
async function apiSynthesize(text, age, sessionId) {
  const res = await fetch('/api/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, age, sessionId }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Browser Speech fallback ───────────────────────────────────────────────────

function browserSpeak(text, age) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return; }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate  = age <= 3 ? 0.82 : age <= 5 ? 0.90 : 0.96;
    utter.pitch = 1.1;
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      /samantha|victoria|karen|nova|female/i.test(v.name)
    );
    if (preferred) utter.voice = preferred;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    speechSynthesis.speak(utter);
    console.warn('[app] TTS fallback: browser SpeechSynthesis used');
  });
}

// ── Image loading ─────────────────────────────────────────────────────────────

function loadImageForSegment(idx) {
  if (state.images[idx] !== undefined) return; // already loading or loaded
  state.images[idx] = null; // mark as loading

  const seg = state.segments[idx];
  if (!seg?.imagePrompt) return;

  apiGenerateImage({
    imagePrompt: seg.imagePrompt,
    segmentIndex: idx,
    sessionId: state.sessionId,
    childAge: state.age,
    theme: state.theme,
    heroName: state.heroName || null,
  }).then(({ imageUrl }) => {
    state.images[idx] = imageUrl || null;
    // If this is the current segment, display immediately
    if (idx === state.currentIdx && imageUrl) {
      displayImage(imageUrl);
    }
  }).catch(() => {
    state.images[idx] = null;
  });
}

function displayImage(url) {
  if (!url) return;
  const img = dom.storyImage;
  img.classList.remove('loaded');
  img.src = url;
  img.onload = () => {
    img.classList.add('loaded');
    dom.imagePlaceholder.style.opacity = '0';
  };
  img.onerror = () => {
    // Keep placeholder visible
    dom.imagePlaceholder.style.opacity = '1';
  };
}

function resetImageZone() {
  dom.storyImage.src = '';
  dom.storyImage.classList.remove('loaded');
  dom.imagePlaceholder.style.opacity = '1';
}

// ── Audio synthesis queue ─────────────────────────────────────────────────────

async function ensureAudioReady(idx) {
  if (state.audioBlobUrls[idx]) return state.audioBlobUrls[idx];

  const seg = state.segments[idx];
  if (!seg?.text) throw new Error('No segment text');

  try {
    const url = await apiSynthesize(seg.text, state.age, state.sessionId);
    state.audioBlobUrls[idx] = url;
    return url;
  } catch (err) {
    console.error(`[app] TTS failed for segment ${idx}:`, err.message);
    // Return a sentinel so the player knows to use fallback
    state.audioBlobUrls[idx] = '__fallback__';
    return '__fallback__';
  }
}

// ── Playback ──────────────────────────────────────────────────────────────────

function stopCurrentAudio() {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.src = '';
    state.currentAudio = null;
  }
  if (state.advanceTimer) {
    clearTimeout(state.advanceTimer);
    state.advanceTimer = null;
  }
}

async function playSegment(idx) {
  if (idx >= state.segments.length) {
    onStoryComplete();
    return;
  }

  state.currentIdx = idx;
  state.isPlaying = true;
  state.isPaused  = false;

  updateProgressDots();
  showSegmentText(state.segments[idx].text);
  updateStatus('Narrating…');
  updateControlButtons();

  // Show image if already available, else it'll appear when ready
  if (state.images[idx]) {
    displayImage(state.images[idx]);
  } else {
    resetImageZone();
    loadImageForSegment(idx);
  }

  // Preload next segment audio in background
  if (idx + 1 < state.segments.length) {
    ensureAudioReady(idx + 1).catch(() => {});
    loadImageForSegment(idx + 1);
  }

  // Get audio for this segment
  let audioUrl;
  try {
    audioUrl = await ensureAudioReady(idx);
  } catch (err) {
    console.error('[app] Could not get audio:', err.message);
    audioUrl = '__fallback__';
  }

  if (audioUrl === '__fallback__') {
    // Browser speech synthesis fallback
    updateStatus('Narrating…');
    await browserSpeak(state.segments[idx].text, state.age);
    if (!state.isPaused) scheduleAdvance();
    return;
  }

  const audio = new Audio(audioUrl);
  state.currentAudio = audio;

  audio.addEventListener('ended', () => {
    state.isPlaying = false;
    if (!state.isPaused) scheduleAdvance();
  });

  audio.addEventListener('error', async (e) => {
    console.error('[app] Audio playback error:', e);
    await browserSpeak(state.segments[idx].text, state.age);
    if (!state.isPaused) scheduleAdvance();
  });

  try {
    await audio.play();
  } catch (err) {
    console.error('[app] Audio play() failed:', err.message);
    await browserSpeak(state.segments[idx].text, state.age);
    if (!state.isPaused) scheduleAdvance();
  }
}

function scheduleAdvance() {
  state.advanceTimer = setTimeout(() => {
    const next = state.currentIdx + 1;
    if (next >= state.segments.length) {
      onStoryComplete();
    } else {
      playSegment(next);
    }
  }, 900);
}

function onStoryComplete() {
  state.isPlaying = false;
  updateControlButtons();
  dom.doneName.textContent = state.childName;
  dom.doneOverlay.classList.add('active');
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

function updateProgressDots() {
  const total = state.totalSegments;
  const current = state.currentIdx;
  dom.progressDots.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot' +
      (i < current  ? ' done' : '') +
      (i === current ? ' current' : '');
    dom.progressDots.appendChild(dot);
  }
}

function showSegmentText(text) {
  dom.storyText.classList.remove('visible');
  dom.storyText.textContent = text;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      dom.storyText.classList.add('visible');
    });
  });
}

function updateStatus(text) {
  dom.statusLine.textContent = text;
}

function updateControlButtons() {
  const ready = state.segments.length > 0 && !state.isProcessing;
  const playing = state.isPlaying && !state.isPaused;

  dom.btnPause.disabled  = !ready;
  dom.btnSkip.disabled   = !ready || state.currentIdx >= state.segments.length - 1;
  dom.btnReplay.disabled = !ready;

  dom.btnPause.textContent = state.isPaused ? '▶ Resume' : '⏸ Pause';
  dom.btnPause.setAttribute('aria-label', state.isPaused ? 'Resume narration' : 'Pause narration');

  // Mic button
  const micReady = ready && !state.isListening && !state.isProcessing;
  dom.micBtn.disabled = !micReady;
  dom.micBtn.classList.toggle('disabled', !micReady);
  dom.micBtn.classList.toggle('listening', state.isListening);
  dom.micLabel.textContent = state.isListening ? 'Listening…' : state.isProcessing ? 'Thinking…' : 'Your idea';
}

// ── Pause / Resume ────────────────────────────────────────────────────────────

function pauseNarration() {
  if (!state.isPlaying && !state.isPaused) return;
  state.isPaused = true;
  if (state.currentAudio) state.currentAudio.pause();
  clearTimeout(state.advanceTimer);
  updateStatus('Paused');
  updateControlButtons();
}

function resumeNarration() {
  if (!state.isPaused) return;
  state.isPaused = false;
  if (state.currentAudio && state.currentAudio.paused) {
    state.currentAudio.play().catch(() => {});
    state.isPlaying = true;
    updateStatus('Narrating…');
  } else {
    // No audio object — re-play current segment
    playSegment(state.currentIdx);
  }
  updateControlButtons();
}

// ── Mic / Recording ───────────────────────────────────────────────────────────

async function handleMicTap() {
  if (state.isListening || state.isProcessing) return;
  if (!navigator.onLine) { showToast('Check your connection'); return; }

  pauseNarration();
  state.isListening = true;
  updateControlButtons();
  openListeningOverlay();

  try {
    await startRecording();
  } catch (err) {
    console.error('[app] Mic error:', err.message);
    closeListeningOverlay();
    state.isListening = false;
    updateControlButtons();

    // Text input fallback
    const text = prompt('What would you like to add to the story?');
    if (text && text.trim()) {
      processCustomization(text.trim());
    } else {
      resumeNarration();
    }
  }
}

function openListeningOverlay() {
  dom.listeningOverlay.classList.add('active');
  dom.transcriptDisplay.textContent = '';
}

function closeListeningOverlay() {
  dom.listeningOverlay.classList.remove('active');
}

async function startRecording() {
  // Request mic permission on first use
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  state.recordingStream = stream;
  state.audioChunks = [];

  // Pick best supported MIME
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : '';

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  state.mediaRecorder = recorder;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
  };

  recorder.onstop = () => {
    onRecordingComplete();
  };

  recorder.start(100); // collect chunks every 100ms

  // Silence detection via AnalyserNode
  try {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);
    startSilenceDetection();
  } catch (e) {
    console.warn('[app] AnalyserNode unavailable, no silence detection:', e.message);
  }

  // Hard max: 8 seconds
  state.maxRecordTimer = setTimeout(() => stopRecording(), 8000);
}

function startSilenceDetection() {
  const analyser = state.analyser;
  if (!analyser) return;

  const bufLen = analyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);
  const START  = Date.now();
  let silenceStart = null;

  state.silenceInterval = setInterval(() => {
    if (!state.isListening) { clearInterval(state.silenceInterval); return; }

    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / bufLen);
    const elapsed = Date.now() - START;

    if (rms < 0.015) {
      if (!silenceStart) silenceStart = Date.now();
      // Don't trigger in the first second — wait for speech to begin
      if (elapsed > 1000 && Date.now() - silenceStart > 1500) {
        stopRecording();
      }
    } else {
      silenceStart = null;
    }
  }, 80);
}

function stopRecording() {
  clearInterval(state.silenceInterval);
  clearTimeout(state.maxRecordTimer);

  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }

  if (state.audioContext) {
    state.audioContext.close().catch(() => {});
    state.audioContext = null;
    state.analyser = null;
  }

  // Stop the mic stream
  if (state.recordingStream) {
    state.recordingStream.getTracks().forEach(t => t.stop());
    state.recordingStream = null;
  }
}

async function onRecordingComplete() {
  state.isListening = false;
  closeListeningOverlay();

  if (state.audioChunks.length === 0) {
    updateControlButtons();
    resumeNarration();
    return;
  }

  state.isProcessing = true;
  updateControlButtons();
  updateStatus('Weaving your idea in…');

  const blob = new Blob(state.audioChunks, {
    type: state.mediaRecorder?.mimeType || 'audio/webm',
  });

  try {
    // 1. Transcribe
    updateStatus('Listening…');
    const { transcript, error: sttError } = await apiTranscribe(blob, state.sessionId, state.age);

    if (sttError || !transcript || transcript.trim().length === 0) {
      showToast(sttError || 'I didn\'t catch that — try again!');
      state.isProcessing = false;
      updateControlButtons();
      resumeNarration();
      return;
    }

    dom.transcriptDisplay.textContent = `"${transcript}"`;

    // 2. Customize story
    updateStatus('Weaving your idea in…');
    const result = await apiCustomizeStory({
      childName:           state.childName,
      age:                 state.age,
      storyTitle:          state.storyTitle,
      storyState:          state.storyState,
      customization:       transcript,
      currentSegmentIndex: state.currentIdx,
      sessionId:           state.sessionId,
    });

    // Replace remaining segments with new ones
    state.segments = [...state.segments.slice(0, state.currentIdx + 1), ...result.segments];
    state.storyState = result.storyState || state.storyState;
    state.totalSegments = state.segments.length;

    // Clear audio cache for new segments
    const startClear = state.currentIdx + 1;
    for (let i = startClear; i < state.segments.length; i++) {
      if (state.audioBlobUrls[i]) {
        URL.revokeObjectURL(state.audioBlobUrls[i]);
        delete state.audioBlobUrls[i];
      }
      delete state.images[i];
    }

    state.isProcessing = false;
    updateProgressDots();

    // Advance to first new segment
    playSegment(state.currentIdx + 1);

  } catch (err) {
    console.error('[app] Customization failed:', err.message);
    state.isProcessing = false;
    updateControlButtons();
    showToast('The story fairies are busy — tap to try again');
    resumeNarration();
  }
}

// ── Handle "Never mind" ───────────────────────────────────────────────────────

function handleNeverMind() {
  // Stop recording immediately
  stopRecording();
  state.isListening = false;
  state.isProcessing = false;
  closeListeningOverlay();
  updateControlButtons();
  resumeNarration();
}

// ── Setup form ────────────────────────────────────────────────────────────────

function initSetupForm() {
  // Age pills
  dom.agePills.addEventListener('click', (e) => {
    const pill = e.target.closest('.age-pill');
    if (!pill) return;
    dom.agePills.querySelectorAll('.age-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    state.age = parseInt(pill.dataset.age, 10);
  });

  // Theme cards
  dom.themeGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    dom.themeGrid.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.theme = card.dataset.theme;
  });

  // Form submit
  dom.form.addEventListener('submit', handleFormSubmit);
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const name = dom.childName.value.trim();
  if (!name) {
    dom.childName.focus();
    showToast('Please enter a name!');
    return;
  }

  state.childName = name;
  state.heroName  = dom.heroName.value.trim();

  if (!navigator.onLine) {
    showToast('Check your connection');
    return;
  }

  dom.btnBegin.disabled = true;
  showScreen('loading');
  startLoadingMessages();

  try {
    const result = await apiGenerateStory({
      childName: state.childName,
      age:       state.age,
      theme:     state.theme,
      heroName:  state.heroName || null,
    });

    stopLoadingMessages();

    // Store story
    state.sessionId    = result.sessionId;
    state.storyTitle   = result.title;
    state.storyState   = result.storyState;
    state.segments     = result.segments;
    state.totalSegments = result.segments.length;
    state.currentIdx   = 0;
    state.images       = {};
    state.audioBlobUrls = {};
    state.isPlaying    = false;
    state.isPaused     = false;
    state.isProcessing = false;

    // Switch to player
    dom.storyTitle.textContent = result.title;
    dom.doneOverlay.classList.remove('active');
    showScreen('player');

    updateProgressDots();
    updateControlButtons();

    // Pre-synthesize segment 0, then play
    // Pre-load images 0 and 1 in background
    loadImageForSegment(0);
    loadImageForSegment(1);

    // Synthesize segment 0 immediately, background-synthesize segment 1
    playSegment(0);

  } catch (err) {
    stopLoadingMessages();
    dom.btnBegin.disabled = false;
    showScreen('setup');
    showToast('The story fairies are busy — tap to try again');
    console.error('[app] Story generation failed:', err.message);
  }
}

// ── Player controls ───────────────────────────────────────────────────────────

function handlePauseResume() {
  if (state.isPaused) {
    resumeNarration();
  } else {
    pauseNarration();
  }
}

function handleReplay() {
  stopCurrentAudio();
  // Clear cached audio for current to force fresh play attempt
  if (state.audioBlobUrls[state.currentIdx]) {
    URL.revokeObjectURL(state.audioBlobUrls[state.currentIdx]);
    delete state.audioBlobUrls[state.currentIdx];
  }
  playSegment(state.currentIdx);
}

function handleSkip() {
  stopCurrentAudio();
  const next = state.currentIdx + 1;
  if (next < state.segments.length) {
    playSegment(next);
  } else {
    onStoryComplete();
  }
}

function handleHome() {
  if (!confirm('Start a new story? The current story will end.')) return;
  resetToSetup();
}

function resetToSetup() {
  stopCurrentAudio();
  stopRecording();
  stopLoadingMessages();

  state.isListening  = false;
  state.isProcessing = false;
  state.isPlaying    = false;
  state.isPaused     = false;

  // Revoke all blob URLs
  Object.values(state.audioBlobUrls).forEach(url => {
    if (url && url !== '__fallback__') URL.revokeObjectURL(url);
  });
  state.audioBlobUrls = {};
  state.images = {};

  dom.doneOverlay.classList.remove('active');
  dom.listeningOverlay.classList.remove('active');
  dom.btnBegin.disabled = false;
  dom.storyText.classList.remove('visible');
  showScreen('setup');
}

// ── Done overlay actions ──────────────────────────────────────────────────────

async function handleMoreStory() {
  dom.doneOverlay.classList.remove('active');
  state.isProcessing = true;
  updateStatus('Weaving your idea in…');
  updateControlButtons();

  try {
    const result = await apiCustomizeStory({
      childName:           state.childName,
      age:                 state.age,
      storyTitle:          state.storyTitle,
      storyState:          state.storyState,
      customization:       'continue with a brand new adventure',
      currentSegmentIndex: state.currentIdx,
      sessionId:           state.sessionId,
    });

    state.segments     = [...state.segments, ...result.segments];
    state.storyState   = result.storyState || state.storyState;
    state.totalSegments = state.segments.length;
    state.isProcessing = false;

    updateProgressDots();
    playSegment(state.currentIdx + 1);

  } catch (err) {
    state.isProcessing = false;
    updateControlButtons();
    showToast('The story fairies are busy — tap to try again');
    console.error('[app] More story failed:', err.message);
    dom.doneOverlay.classList.add('active');
  }
}

// ── Stars background ──────────────────────────────────────────────────────────

function initStarfield() {
  const container = $('stars-bg');
  for (let i = 0; i < 60; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    const size = Math.random() * 2.5 + 0.5;
    star.style.cssText = `
      left: ${Math.random() * 100}%;
      top:  ${Math.random() * 100}%;
      width:  ${size}px;
      height: ${size}px;
      --dur:   ${(Math.random() * 4 + 2).toFixed(1)}s;
      --delay: ${(Math.random() * 4).toFixed(1)}s;
    `;
    container.appendChild(star);
  }
}

// ── Connectivity ──────────────────────────────────────────────────────────────

function initConnectivityListener() {
  window.addEventListener('offline', () => showToast('Check your connection'));
}

// ── Event bindings ─────────────────────────────────────────────────────────────

function bindEvents() {
  dom.micBtn.addEventListener('click', handleMicTap);
  dom.btnNeverMind.addEventListener('click', handleNeverMind);
  dom.btnPause.addEventListener('click', handlePauseResume);
  dom.btnReplay.addEventListener('click', handleReplay);
  dom.btnSkip.addEventListener('click', handleSkip);
  dom.btnHome.addEventListener('click', handleHome);
  dom.btnMoreStory.addEventListener('click', handleMoreStory);
  dom.btnNewStory.addEventListener('click', resetToSetup);

  // Prevent default touch delay on buttons for snappier UX
  document.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('touchstart', () => {}, { passive: true });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  initStarfield();
  initSetupForm();
  bindEvents();
  initConnectivityListener();

  // Default selections
  state.age   = 5;
  state.theme = 'animals';
}

init();
