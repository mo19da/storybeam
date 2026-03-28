'use strict';

const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

// Story generation is expensive — limit more aggressively
const storyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many story requests, please slow down.' },
});

const transcribeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many transcription requests.' },
});

module.exports = { generalLimiter, storyLimiter, transcribeLimiter };
