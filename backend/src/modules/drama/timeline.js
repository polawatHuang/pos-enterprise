'use strict';

const { DEFAULT_FONT_URL, estimateMs, srtTime, wordChunks, planShots } = require('../video/timeline');

/**
 * Pure builder (unit-tested): a ละคร AI video as a Shotstack edit, 1080x1920.
 *   title card (cover + title) → shots in order. A shot lasts as long as its voice lines (narrator,
 *   then characters) plus small gaps; it shows its H3 clip (then holds its still) or the still with a
 *   slow camera move. Word-by-word captions: narrator in white, characters in yellow with their name.
 */
const TITLE_SEC = 2.5;
const GAP_SEC = 0.25;
const MIN_SHOT_SEC = 2.5;
const r2 = (n) => Math.round(n * 100) / 100;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const captionCss = (dialogue) =>
  `p { font-family: 'Sarabun'; font-weight: 800; font-size: 76px; line-height: 1.15; text-align: center; color: ${dialogue ? '#FFE600' : '#FFFFFF'};` +
  ' text-shadow: 0 0 8px #000, 4px 4px 0 #000, -4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 0 8px 18px rgba(0,0,0,0.7); }';
const nameCss =
  "p { font-family: 'Sarabun'; font-weight: 700; font-size: 44px; text-align: center; color: #111827; background: #FFE600; padding: 6px 22px; border-radius: 14px; display: inline-block; }";
const titleCss =
  "p { font-family: 'Sarabun'; font-weight: 800; font-size: 104px; line-height: 1.1; text-align: center; color: #FFFFFF; text-shadow: 0 6px 24px rgba(0,0,0,0.9), 0 0 4px #000; }";

/**
 * @param {{title:string, coverUrl:string|null, musicUrl?:string|null, fontUrl?:string,
 *   shots:{image:string|null, clip:string|null, clipSec:number|null, product?:{url:string, name:string|null}|null, lines:{speaker:string, name?:string|null, text:string, url:string, ms:number|null}[]}[]}} p
 * @returns {{edit:object, srt:string, durationSec:number}}
 */
function buildDramaEdit({ title, coverUrl, shots, musicUrl = null, fontUrl = DEFAULT_FONT_URL }) {
  const intro = coverUrl ? TITLE_SEC : 0;
  let t = intro;
  const shotTimes = [];
  const voice = [];
  const words = [];
  const names = [];
  const cues = [];
  for (const s of shots) {
    const start = t;
    let cursor = start + 0.15;
    for (const l of s.lines) {
      const len = r2((l.ms ?? estimateMs(l.text)) / 1000);
      voice.push({ asset: { type: 'audio', src: l.url, volume: 1 }, start: r2(cursor), length: len });
      cues.push({ start: cursor, end: cursor + len, text: l.name ? `${l.name}: ${l.text}` : l.text });
      const dialogue = l.speaker !== 'narrator';
      const chunks = wordChunks(l.text, 14);
      const each = len / Math.max(1, chunks.length);
      chunks.forEach((text, i) =>
        words.push({
          asset: { type: 'html', html: `<p>${escapeHtml(text)}</p>`, css: captionCss(dialogue), width: 960, height: 260 },
          start: r2(cursor + i * each),
          length: r2(each),
          position: 'center',
          offset: { y: -0.12 },
          transition: { in: 'zoom' },
        }),
      );
      if (dialogue && l.name) {
        names.push({
          asset: { type: 'html', html: `<p>${escapeHtml(l.name)}</p>`, css: nameCss, width: 600, height: 110 },
          start: r2(cursor),
          length: len,
          position: 'center',
          offset: { y: 0.02 },
        });
      }
      cursor += len + GAP_SEC;
    }
    const length = r2(Math.max(MIN_SHOT_SEC, cursor - start + 0.2));
    shotTimes.push({ start: r2(start - intro), length });
    t = start + length;
  }
  const visuals = shots.map((s) =>
    s.clip ? { type: 'video', url: s.clip, durationSec: s.clipSec, hold: s.image } : s.image ? { type: 'image', url: s.image } : null,
  );
  const visualClips = planShots({ timings: shotTimes, visuals, offset: intro, single: true });
  if (coverUrl) {
    visualClips.unshift({ start: 0, length: intro, fit: 'crop', asset: { type: 'image', src: coverUrl }, effect: 'zoomInSlow' });
  }
  // Tie-in shots: the real product photo as a card with its name, top right (clear of captions)
  const productCards = shots.flatMap((s, i) =>
    s.product?.url
      ? [
          {
            asset: { type: 'image', src: s.product.url },
            start: r2(shotTimes[i].start + intro + 0.3),
            length: r2(Math.max(1, shotTimes[i].length - 0.3)),
            fit: 'contain',
            scale: 0.32,
            position: 'topRight',
            offset: { x: -0.04, y: -0.1 },
            transition: { in: 'zoom', out: 'fade' },
          },
          ...(s.product.name
            ? [
                {
                  asset: { type: 'html', html: `<p>${escapeHtml(s.product.name)}</p>`, css: nameCss, width: 520, height: 100 },
                  start: r2(shotTimes[i].start + intro + 0.3),
                  length: r2(Math.max(1, shotTimes[i].length - 0.3)),
                  position: 'topRight',
                  offset: { x: -0.03, y: -0.33 },
                  transition: { in: 'fade', out: 'fade' },
                },
              ]
            : []),
        ]
      : [],
  );
  const titleCard = coverUrl
    ? [{ asset: { type: 'html', html: `<p>${escapeHtml(title)}</p>`, css: titleCss, width: 980, height: 600 }, start: 0, length: intro, position: 'top', offset: { y: -0.12 }, transition: { in: 'fade', out: 'fade' } }]
    : [];
  const label = {
    asset: { type: 'html', html: '<p>สร้างด้วย AI</p>', css: "p { font-family: 'Sarabun'; font-weight: 700; color: #f1f5f9; font-size: 30px; }", width: 360, height: 80 },
    start: 0,
    length: Math.max(0.1, r2(t)),
    position: 'topLeft',
    offset: { x: 0.03, y: -0.03 },
    opacity: 0.85,
  };
  const srt = cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
  const edit = {
    timeline: {
      background: '#000000',
      fonts: [{ src: fontUrl }],
      ...(musicUrl ? { soundtrack: { src: musicUrl, effect: 'fadeInFadeOut', volume: 0.1 } } : {}),
      tracks: [{ clips: [label] }, { clips: titleCard }, { clips: names }, { clips: words }, { clips: productCards }, { clips: voice }, { clips: visualClips }].filter(
        (tr) => tr.clips.length,
      ),
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  };
  return { edit, srt, durationSec: Math.round(t) };
}

module.exports = { buildDramaEdit, TITLE_SEC };
