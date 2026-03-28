# ✨ StoryBeam

Voice-first AI storytelling for children aged 2–6. Say something, and the story changes. Powered by Claude, Deepgram, and OpenAI.

---

## Setup in 5 steps

### 1. Install dependencies

```bash
cd storybeam/backend
npm install
```

Requires **Node.js ≥ 18** (uses native fetch).

---

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Then open `.env` and fill in your API keys:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...
PORT=3000
```

- **Anthropic** — https://console.anthropic.com/
- **OpenAI** — https://platform.openai.com/api-keys
- **Deepgram** — https://console.deepgram.com/

---

### 3. Start the server

```bash
npm start
```

You should see:

```
✨ StoryBeam is running at http://localhost:3000
```

---

### 4. Open in your browser

```
http://localhost:3000
```

On mobile: find your machine's local IP (e.g. `192.168.1.x`) and open `http://192.168.1.x:3000` on the phone. Make sure both devices are on the same Wi-Fi.

---

### 5. Test the health endpoint

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{ "status": "ok", "timestamp": "2026-...", "uptime_seconds": 5 }
```

---

## Test each backend route with curl

**Generate a story:**
```bash
curl -s -X POST http://localhost:3000/api/generate-story \
  -H "Content-Type: application/json" \
  -d '{"childName":"Mia","age":4,"theme":"animals","heroName":"Rosie"}' \
  | jq .title
```

**Check TTS (saves audio.mp3):**
```bash
curl -s -X POST http://localhost:3000/api/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Once upon a time, a little bunny hopped into the forest.","age":4}' \
  --output audio.mp3
```

---

## Where to find logs after a test session

```
storybeam/logs/logs.jsonl
```

Each line is a JSON object with: `ts`, `event`, `sessionId`, `childAge`, `theme`, `inputTokens`, `outputTokens`, `latencyMs`, `success`, `errorMessage`, `fallbackUsed`.

View recent logs:
```bash
tail -20 ../logs/logs.jsonl | jq .
```

View just latencies:
```bash
cat ../logs/logs.jsonl | jq '{event, latencyMs, success}'
```

---

## Latency targets

| Stage | Target |
|-------|--------|
| Story generation end-to-end | < 6 s |
| TTS first byte | < 1.2 s |
| Transcription (2–4s child utterance) | < 800 ms |
| Customization segments | < 5 s |
| Image visible | < 8 s (async, never blocks audio) |

---

## Architecture notes

- **No AI calls from the browser** — all API calls go through the Express backend
- **Images are async and non-blocking** — narration starts immediately; images fade in when ready
- **TTS is cached** in `/tmp/tts_cache/` — repeated segments serve from disk in < 10ms
- **Story state** is a JSON object passed with every Claude call — ensures character/setting consistency across segments
- **Silence detection** auto-stops the mic after 1.5s of quiet (after ≥1s of speech detected)
- **Safety layer** server-side: theme allowlist, age validation, customization sanitization, output validation with one retry

## Deployment to Railway / Render

1. Push to a GitHub repo
2. Connect to Railway or Render
3. Set root directory to `storybeam/backend`
4. Add the three API keys as environment variables
5. The `npm start` command is already set in `package.json`
