'use strict';

const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '../../logs');
const logsFile = path.join(logsDir, 'logs.jsonl');

function ensureLogsDir() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

/**
 * Write a structured log entry to logs.jsonl.
 * @param {object} entry
 */
function log(entry) {
  try {
    ensureLogsDir();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event: entry.event || 'unknown',
      sessionId: entry.sessionId || null,
      childAge: entry.childAge ?? null,
      theme: entry.theme || null,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      latencyMs: entry.latencyMs ?? null,
      success: entry.success !== undefined ? entry.success : true,
      errorMessage: entry.errorMessage || null,
      fallbackUsed: entry.fallbackUsed || false,
    }) + '\n';
    fs.appendFileSync(logsFile, line);
  } catch (err) {
    // Never let logging crash the app
    console.error('[logger] Failed to write log:', err.message);
  }
}

module.exports = { log };
