#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { KID_KEYWORDS } = require('../data/kidKeywords');
const { ensureCached, loadIndex } = require('../pipeline/imageGenerator');

const DELAY = process.env.UNSPLASH_ACCESS_KEY ? 1500 : 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const kws = Object.entries(KID_KEYWORDS);
  const idx  = loadIndex();
  const src  = process.env.UNSPLASH_ACCESS_KEY
    ? 'Unsplash (beautiful photos)'
    : 'Picsum (add UNSPLASH_ACCESS_KEY for better images)';
  console.log('StoryBeam image pre-fetcher');
  console.log('Source:', src);
  console.log('Keywords:', kws.length, '| Variations: 3 | Est disk: ~25MB\n');

  let done = 0, skip = 0, fail = 0;
  for (const [kw, q] of kws) {
    if ((idx[kw] || []).length >= 3) { console.log('  cached:', kw); skip++; continue; }
    process.stdout.write('  ' + kw.padEnd(16) + ' "' + q.slice(0, 35) + '"... ');
    try {
      const files = await ensureCached(kw, q);
      process.stdout.write(files.length + ' images\n');
      if (files.length > 0) done++; else fail++;
    } catch (e) {
      process.stdout.write('FAILED: ' + e.message + '\n');
      fail++;
    }
    await sleep(DELAY);
  }
  console.log('\nDone. fetched=' + done + ' skipped=' + skip + ' failed=' + fail);
  console.log('Restart the server. Images now serve from disk at $0/image.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
