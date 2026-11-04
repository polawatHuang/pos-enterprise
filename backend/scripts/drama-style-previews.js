'use strict';
/* eslint-disable no-console -- command-line script */

/**
 * Builds the ละคร AI style gallery's built-in sample pictures with MiniMax image-01:
 * one picture per genre × style (catalog.previewPrompt), saved as small WebP files in
 * frontend/public/drama-styles/<genre>/<style>.webp. Existing files are skipped, so a
 * re-run only fills the gaps. "custom" uses the drama set (see the studio).
 *
 *   MINIMAX_API_KEY=… node scripts/drama-style-previews.js [genre …]
 */
const fs = require('node:fs');
const path = require('node:path');
const { GENRES, STYLES, previewPrompt } = require('../src/modules/drama/catalog');

const KEY = process.env.MINIMAX_API_KEY;
const HOST = (process.env.MINIMAX_API_HOST || 'https://api.minimax.io').replace(/\/+$/, '');
const OUT = path.join(__dirname, '..', '..', 'frontend', 'public', 'drama-styles');
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '..', '..', 'frontend'), __dirname] }));

async function generate(prompt) {
  const res = await fetch(`${HOST}/v1/image_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'image-01', prompt, aspect_ratio: '4:3', response_format: 'base64', n: 1, prompt_optimizer: true }),
    signal: AbortSignal.timeout(180_000),
  });
  const json = await res.json().catch(() => null);
  const b64 = json?.data?.image_base64?.[0];
  if (!res.ok || !b64) throw new Error(json?.base_resp?.status_msg || `HTTP ${res.status}`);
  return Buffer.from(b64, 'base64');
}

async function main() {
  if (!KEY) throw new Error('ตั้ง MINIMAX_API_KEY ก่อน');
  const only = process.argv.slice(2);
  const genres = GENRES.filter((g) => g.id !== 'custom' && (!only.length || only.includes(g.id)));
  const failed = [];
  let made = 0;
  for (const g of genres) {
    fs.mkdirSync(path.join(OUT, g.id), { recursive: true });
    for (const s of STYLES) {
      const file = path.join(OUT, g.id, `${s.id}.webp`);
      if (fs.existsSync(file)) continue;
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
        try {
          const img = await generate(previewPrompt(g.id, s.id));
          await sharp(img).resize(480, 360, { fit: 'cover' }).webp({ quality: 74 }).toFile(file);
          ok = true;
          made += 1;
          console.log(`✓ ${g.id}/${s.id}`);
        } catch (err) {
          console.log(`… ${g.id}/${s.id} attempt ${attempt}: ${err.message}`);
          if (attempt === 3) failed.push(`${g.id}/${s.id}: ${err.message}`);
        }
      }
    }
  }
  console.log(`\nสร้างใหม่ ${made} ภาพ${failed.length ? ` · ไม่สำเร็จ ${failed.length}:\n${failed.join('\n')}` : ''}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
