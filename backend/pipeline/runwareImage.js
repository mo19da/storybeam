'use strict';

/**
 * Runware image generation.
 *
 * Generates a custom illustration from a story prompt using FLUX.1 [schnell]
 * (or any model set via RUNWARE_MODEL env var).
 *
 * Cost: ~$0.0006/image for FLUX.1 [schnell].
 * Model IDs — verify in your Runware dashboard under "Models":
 *   FLUX.1 [schnell]:   runware:100@1
 *   FLUX.2 [klein] 9B:  runware:101@1   (better quality, ~$0.002)
 *   FLUX.1 [dev]:       bfl:3@1
 *
 * Docs: https://docs.runware.ai/en/image-inference/api-reference
 */

const { v4: uuidv4 } = require('uuid');

const RUNWARE_API = 'https://api.runware.ai/v1';
const MODEL       = process.env.RUNWARE_MODEL || 'runware:100@1';

// Append this to every prompt so outputs stay illustrated and child-safe
const STYLE_SUFFIX = ', children\'s storybook illustration, warm vibrant colors, soft lighting, safe for young children, no text, no letters';

/**
 * Generate one image from a story segment imagePrompt.
 * Returns the remote image URL, or null on failure.
 */
async function generateRunwareImage(imagePrompt, age) {
  const key = process.env.RUNWARE_API_KEY;
  if (!key) return null;

  // Younger kids get simpler, softer compositions; older kids get more detail
  const styleGuide = age <= 3
    ? 'simple composition, single subject, very cute, soft muted earth tones, minimal colors, gentle watercolor, flat illustration, soothing and calm'
    : 'detailed scene, storybook adventure, vivid illustration, dynamic composition';

  const fullPrompt = `${imagePrompt}, ${styleGuide}${STYLE_SUFFIX}`;

  const body = [
    {
      taskType:       'imageInference',
      taskUUID:       uuidv4(),
      positivePrompt: fullPrompt,
      negativePrompt: 'scary, horror, violence, blood, dark, disturbing, ugly, text, watermark, signature, adult content',
      model:          MODEL,
      width:          832,
      height:         512,
      numberResults:  1,
      outputType:     ['URL'],
      outputFormat:   'JPEG',
      CFGScale:       3.5,
      steps:          4,         // schnell works well at 4 steps
    },
  ];

  const res = await fetch(RUNWARE_API, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Runware HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();

  // Response is an array of task results
  const result = Array.isArray(data) ? data[0] : data?.data?.[0];
  const imageURL = result?.imageURL || result?.url || null;

  if (!imageURL) {
    throw new Error(`Runware: no imageURL in response — ${JSON.stringify(data).slice(0, 200)}`);
  }

  return imageURL;
}

module.exports = { generateRunwareImage };
