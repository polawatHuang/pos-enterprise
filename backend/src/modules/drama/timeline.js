'use strict';

const { DEFAULT_FONT_URL, estimateMs, srtTime, wordChunks, renderResolution } = require('../video/timeline');

/**
 * Pure builder (unit-tested): one ละคร AI episode as a Shotstack edit, 1080x1920.
 *   Shots in order, every one a moving H3 clip — no still pictures. A shot lasts as long as its voice
 *   lines (narrator, then characters) plus small gaps; if the clip is shorter than that, the clip's
 *   last moments play again rather than freezing. The title (and "ตอนที่ N") sits on the opening
 *   clip, "ติดตามตอนที่ N+1" / "จบบริบูรณ์" on the closing one. Phrase captions at the bottom: narrator
 *   in white italic, characters in yellow after a name tag.
 */
const TITLE_SEC = 3;
const END_SEC = 2.5;
const GAP_SEC = 0.25;
const MIN_SHOT_SEC = 2.5;
const r2 = (n) => Math.round(n * 100) / 100;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Captions: one short phrase at a time, still (no zoom — a zooming word reads as a giant ghost letter on a
 * paused frame), at the bottom clear of faces and above TikTok's own buttons. Character lines are yellow
 * with the speaker's name in a white tag before them; the narrator is white italic.
 */
const captionCss = (dialogue) =>
  `p { font-family: 'Sarabun'; font-weight: 800; font-size: 62px; line-height: 1.2; text-align: center; color: ${dialogue ? '#FFE600' : '#FFFFFF'};` +
  `${dialogue ? '' : ' font-style: italic;'}` +
  ' text-shadow: 0 0 6px #000, 3px 3px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 0 6px 14px rgba(0,0,0,0.8); }' +
  " .n { font-style: normal; font-weight: 800; font-size: 46px; color: #111827; background: #FFFFFF; padding: 2px 16px; border-radius: 12px; margin-right: 14px; text-shadow: none; vertical-align: middle; }";
const CAPTION_CHARS = 20;
const nameCss =
  "p { font-family: 'Sarabun'; font-weight: 700; font-size: 44px; text-align: center; color: #111827; background: #FFE600; padding: 6px 22px; border-radius: 14px; display: inline-block; }";
const titleCss =
  "p { font-family: 'Sarabun'; font-weight: 800; font-size: 92px; line-height: 1.12; text-align: center; color: #FFFFFF; background: rgba(0,0,0,0.55); padding: 18px 30px; border-radius: 26px; text-shadow: 0 4px 18px rgba(0,0,0,0.9); }";
const badgeCss =
  "p { font-family: 'Sarabun'; font-weight: 800; font-size: 52px; text-align: center; color: #FFFFFF; background: #E11D48; padding: 8px 28px; border-radius: 16px; display: inline-block; }";

/**
 * The shot's clip for its whole length: play it from the start; when the shot is longer than the clip,
 * replay the clip's last moments (motion keeps going — a still frame is never shown).
 */
function clipCover(url, clipSec, start, length) {
  const dur = Math.max(1, Number(clipSec) || length);
  const out = [{ start: r2(start), length: r2(Math.min(length, dur)), fit: 'crop', asset: { type: 'video', src: url, volume: 0 } }];
  let t = start + dur;
  const end = start + length;
  while (end - t > 0.05) {
    const piece = Math.min(end - t, dur);
    out.push({ start: r2(t), length: r2(piece), fit: 'crop', asset: { type: 'video', src: url, volume: 0, ...(dur - piece > 0.05 ? { trim: r2(dur - piece) } : {}) } });
    t += piece;
  }
  return out;
}

/**
 * @param {{title:string, subtitle?:string|null, endText?:string|null, musicUrl?:string|null, fontUrl?:string,
 *   shots:{clip:string, clipSec:number|null, product?:{url:string, name:string|null}|null, lines:{speaker:string, name?:string|null, text:string, url:string, ms:number|null}[]}[]}} p
 * @returns {{edit:object, srt:string, durationSec:number}}
 */
function buildDramaEdit({ title, subtitle = null, endText = null, shots, musicUrl = null, fontUrl = DEFAULT_FONT_URL }) {
  let t = 0;
  const shotTimes = [];
  const voice = [];
  const words = [];
  const cues = [];
  for (const s of shots) {
    const start = t;
    // the opening shot leaves room for the title before the first line
    let cursor = start + (start === 0 && title ? 1.2 : 0.15);
    for (const l of s.lines) {
      const len = r2((l.ms ?? estimateMs(l.text)) / 1000);
      voice.push({ asset: { type: 'audio', src: l.url, volume: 1 }, start: r2(cursor), length: len });
      cues.push({ start: cursor, end: cursor + len, text: l.name ? `${l.name}: ${l.text}` : l.text });
      const dialogue = l.speaker !== 'narrator';
      const chunks = wordChunks(l.text, CAPTION_CHARS);
      const each = len / Math.max(1, chunks.length);
      const tag = dialogue && l.name ? `<span class="n">${escapeHtml(l.name)}</span>` : '';
      chunks.forEach((text, i) =>
        words.push({
          asset: { type: 'html', html: `<p>${tag}${escapeHtml(text)}</p>`, css: captionCss(dialogue), width: 1000, height: 240 },
          start: r2(cursor + i * each),
          length: r2(each),
          position: 'bottom',
          offset: { y: 0.16 },
        }),
      );
      cursor += len + GAP_SEC;
    }
    const length = r2(Math.max(MIN_SHOT_SEC, cursor - start + 0.2));
    shotTimes.push({ start: r2(start), length });
    t = start + length;
  }
  const visualClips = shots.flatMap((s, i) => (s.clip ? clipCover(s.clip, s.clipSec, shotTimes[i].start, shotTimes[i].length) : []));
  // Tie-in shots: the real product photo as a card with its name, top right (clear of captions)
  const productCards = shots.flatMap((s, i) =>
    s.product?.url
      ? [
          {
            asset: { type: 'image', src: s.product.url },
            start: r2(shotTimes[i].start + 0.3),
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
                  start: r2(shotTimes[i].start + 0.3),
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
  const total = r2(t);
  const overlays = [];
  if (title) {
    overlays.push({
      asset: { type: 'html', html: `<p>${escapeHtml(title)}</p>`, css: titleCss, width: 980, height: 520 },
      start: 0,
      length: Math.min(TITLE_SEC, total),
      position: 'top',
      offset: { y: -0.08 },
      transition: { in: 'fade', out: 'fade' },
    });
    if (subtitle) {
      overlays.push({
        asset: { type: 'html', html: `<p>${escapeHtml(subtitle)}</p>`, css: badgeCss, width: 900, height: 120 },
        start: 0.3,
        length: Math.max(0.5, Math.min(TITLE_SEC, total) - 0.3),
        position: 'top',
        offset: { y: -0.33 },
        transition: { in: 'fade', out: 'fade' },
      });
    }
  }
  if (endText && total > END_SEC + TITLE_SEC) {
    overlays.push({
      asset: { type: 'html', html: `<p>${escapeHtml(endText)}</p>`, css: badgeCss, width: 900, height: 120 },
      start: r2(total - END_SEC),
      length: END_SEC,
      position: 'top',
      offset: { y: -0.14 },
      transition: { in: 'zoom', out: 'fade' },
    });
  }
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
      tracks: [{ clips: [label] }, { clips: overlays }, { clips: words }, { clips: productCards }, { clips: voice }, { clips: visualClips }].filter(
        (tr) => tr.clips.length,
      ),
    },
    output: { format: 'mp4', resolution: renderResolution(), aspectRatio: '9:16', fps: 30 },
  };
  return { edit, srt, durationSec: Math.round(t) };
}

module.exports = { buildDramaEdit, clipCover, TITLE_SEC };
