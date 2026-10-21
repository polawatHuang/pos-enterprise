'use strict';

/**
 * Pure builders for the composition step (unit-tested): scene timing, SRT subtitles and the
 * Shotstack edit JSON. Times are in seconds.
 */

const DEFAULT_FONT_URL = 'https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Bold.ttf';

/** Fallback when the TTS provider does not report a duration: ~12 Thai characters per second. */
const estimateMs = (text) => Math.max(1500, Math.round((String(text).replace(/\s/g, '').length / 12) * 1000));

/**
 * @param {{voiceover:string}[]} scenes
 * @param {(number|null)[]} voiceMs per scene
 * @returns {{start:number, length:number}[]} each scene lasts as long as its voice-over plus a short breath
 */
function sceneTimings(scenes, voiceMs) {
  let t = 0;
  return scenes.map((s, i) => {
    const ms = voiceMs[i] ?? estimateMs(s.voiceover);
    const length = Math.round((ms / 1000 + 0.3) * 100) / 100;
    const slot = { start: Math.round(t * 100) / 100, length };
    t += length;
    return slot;
  });
}

const srtTime = (sec) => {
  const ms = Math.round(sec * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

/** Subtitles from the voice-over, split into short lines spread evenly across each scene. */
function buildSrt(scenes, timings, maxChars = 32) {
  const cues = [];
  scenes.forEach((s, i) => {
    const words = String(s.voiceover).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (cur && `${cur} ${w}`.length > maxChars) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    const { start, length } = timings[i];
    const per = length / Math.max(1, lines.length);
    lines.forEach((text, j) => cues.push({ start: start + j * per, end: start + (j + 1) * per, text }));
  });
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const TITLE_FONT_URL = 'https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-ExtraBold.ttf';
/** Longest single shot: fast cuts keep short-video viewers watching. */
const MAX_SHOT_SEC = 1.8;
const INTRO_SEC = 0.5;
const IMAGE_EFFECTS = ['zoomIn', 'slideLeft', 'zoomOut', 'slideRight', 'zoomInSlow', 'slideUp'];
const SLOW_EFFECTS = ['zoomInSlow', 'zoomOutSlow'];
/** Words worth a different colour in captions: prices, numbers, offers. */
const EMPHASIS = /[0-9๐-๙%฿]|ฟรี|ลด|ถูก|ส่วนลด|โปร|ด่วน|ที่สุด|ใหม่|ห้ามพลาด/;

/** Thai has no spaces: split into words (Intl.Segmenter), then into punchy 1–3 word chunks. */
function wordChunks(text, maxChars = 12) {
  const src = String(text ?? '').trim();
  if (!src) return [];
  const words =
    typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(src), (x) => x.segment) : src.split(/(\s+)/);
  const chunks = [];
  let cur = '';
  for (const w of words) {
    if (/^\s+$/.test(w)) {
      if (cur.trim()) chunks.push(cur.trim());
      cur = '';
      continue;
    }
    if (cur && (cur + w).replace(/\s/g, '').length > maxChars) {
      chunks.push(cur.trim());
      cur = w;
    } else cur += w;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => /[\p{L}\p{N}]/u.test(c));
}

/**
 * Word-by-word caption cues: each scene's voice-over chunks share the scene time by length,
 * so they roughly follow the speech. offset = intro length.
 */
function captionCues(scenes, timings, offset = 0) {
  const cues = [];
  scenes.forEach((s, i) => {
    const chunks = wordChunks(s.voiceover);
    if (!chunks.length) return;
    const weights = chunks.map((c) => Math.max(2, c.length));
    const sum = weights.reduce((a, b) => a + b, 0);
    let t = timings[i].start + offset;
    const len = Math.max(0.3, timings[i].length - 0.2);
    chunks.forEach((text, j) => {
      const d = Math.round(((len * weights[j]) / sum) * 100) / 100;
      cues.push({ start: Math.round(t * 100) / 100, length: Math.max(0.2, d), text, emphasis: EMPHASIS.test(text) });
      t += d;
    });
  });
  return cues;
}

/**
 * Fast-cut visuals: every scene is split into shots of ≤ MAX_SHOT_SEC. The scene's own visual (AI clip /
 * chosen footage) opens the scene; further shots rotate through the source pool (own footage, product
 * photos) with different trims / pan-zoom effects.
 * @param {{type:'video'|'image', url:string, durationSec?:number}[]} pool
 */
function planShots({ timings, visuals = [], pool = [], offset = 0, single = false }) {
  const shots = [];
  const cursor = new Map(); // url → next trim position, so repeated clips show new moments
  let n = 0;
  timings.forEach((tm, i) => {
    const own = visuals[i] ?? null;
    const sources = own ? [own, ...pool.filter((p) => p.url !== own.url)] : pool;
    if (!sources.length) return;
    // single: the scene's own picture holds for the whole scene (scene images played in order)
    const count = single ? 1 : Math.max(1, Math.ceil(tm.length / MAX_SHOT_SEC - 0.05));
    const len = tm.length / count;
    for (let j = 0; j < count; j += 1) {
      const src = j === 0 ? sources[0] : sources[(n + j) % sources.length];
      const start = Math.round((offset + tm.start + j * len) * 100) / 100;
      const length = Math.round(len * 100) / 100;
      if (src.type === 'video') {
        const dur = Number(src.durationSec) || 0;
        let trim = cursor.get(src.url) ?? 0;
        if (dur && trim + length > dur) trim = 0;
        cursor.set(src.url, trim + length);
        shots.push({ start, length, fit: 'crop', asset: { type: 'video', src: src.url, volume: 0, ...(trim ? { trim: Math.round(trim * 100) / 100 } : {}) } });
      } else {
        const effect = single ? SLOW_EFFECTS[i % SLOW_EFFECTS.length] : shots.length === 0 ? 'zoomInFast' : IMAGE_EFFECTS[shots.length % IMAGE_EFFECTS.length];
        shots.push({ start, length, fit: 'crop', asset: { type: 'image', src: src.url }, effect });
      }
    }
    n += count;
  });
  return shots;
}

const CAPTION_CSS = {
  pop: (emphasis) =>
    `p { font-family: 'Kanit'; font-weight: 800; font-size: 92px; line-height: 1.1; text-align: center; color: ${emphasis ? '#FFE600' : '#FFFFFF'};` +
    ' text-shadow: 0 0 8px #000, 4px 4px 0 #000, -4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 0 8px 18px rgba(0,0,0,0.7); }',
  clean: (emphasis) =>
    `p { font-family: 'Kanit'; font-weight: 800; font-size: 68px; line-height: 1.15; text-align: center; color: ${emphasis ? '#FDE047' : '#FFFFFF'};` +
    ' background: rgba(0,0,0,0.55); padding: 10px 26px; border-radius: 18px; display: inline-block; }',
};

/**
 * Shotstack edit: 1080x1920 mp4 — optional cover intro frame, fast-cut visuals, voice-over per scene,
 * word-by-word captions inside the TikTok safe zone, scene headline on top and an "AI-generated" label.
 * @param {{scenes:object[], timings:object[], voiceUrls:string[], visuals:({type:'video'|'image', url:string, durationSec?:number}|null)[],
 *   pool?:object[], single?:boolean, captionStyle?:'pop'|'clean'|'none', introUrl?:string|null, fontUrl?:string, musicUrl?:string}} p
 */
function buildShotstackEdit({
  scenes,
  timings,
  voiceUrls,
  visuals,
  pool = [],
  single = false,
  captionStyle = 'pop',
  introUrl = null,
  fontUrl = DEFAULT_FONT_URL,
  musicUrl = null,
}) {
  const offset = introUrl ? INTRO_SEC : 0;
  const total = (timings.length ? timings.at(-1).start + timings.at(-1).length : 0) + offset;
  const wordCaps = captionStyle !== 'none';
  const css = (size) =>
    `p { font-family: 'Sarabun'; font-weight: 700; color: #ffffff; font-size: ${size}px; text-align: center; line-height: 1.25;` +
    ' text-shadow: 0 4px 16px rgba(0,0,0,0.85); }';
  // Scene headline sits high (below TikTok's top bar); word captions sit just under the centre,
  // clear of the caption/buttons area at the bottom and right.
  const captions = scenes
    .map((s, i) =>
      s.caption
        ? {
            asset: { type: 'html', html: `<p>${escapeHtml(s.caption)}</p>`, css: css(wordCaps ? 64 : 76), width: 960, height: 400 },
            start: timings[i].start + offset,
            length: timings[i].length,
            position: 'center',
            offset: { y: wordCaps ? 0.3 : 0.28 },
            transition: { in: 'fade', out: 'fade' },
          }
        : null,
    )
    .filter(Boolean);
  const words = wordCaps
    ? captionCues(scenes, timings, offset).map((c) => ({
        asset: {
          type: 'html',
          html: `<p>${escapeHtml(c.text)}</p>`,
          css: CAPTION_CSS[captionStyle === 'clean' ? 'clean' : 'pop'](c.emphasis),
          width: 900,
          height: 260,
        },
        start: c.start,
        length: c.length,
        position: 'center',
        offset: { y: -0.1 },
        ...(captionStyle === 'pop' ? { transition: { in: 'zoom' } } : {}),
      }))
    : [];
  const label = {
    asset: { type: 'html', html: '<p>สร้างด้วย AI</p>', css: css(30).replace('#ffffff', '#f1f5f9'), width: 360, height: 80 },
    start: 0,
    length: Math.max(0.1, total),
    position: 'topLeft',
    offset: { x: 0.03, y: -0.03 },
    opacity: 0.85,
  };
  const visualClips = planShots({ timings, visuals, pool, offset, single });
  if (introUrl) visualClips.unshift({ start: 0, length: INTRO_SEC, fit: 'crop', asset: { type: 'image', src: introUrl } });
  const voice = voiceUrls.map((url, i) => ({ asset: { type: 'audio', src: url, volume: 1 }, start: timings[i].start + offset, length: timings[i].length }));

  return {
    timeline: {
      background: '#111827',
      fonts: [{ src: fontUrl }, ...(wordCaps ? [{ src: TITLE_FONT_URL }] : [])],
      ...(musicUrl ? { soundtrack: { src: musicUrl, effect: 'fadeInFadeOut', volume: 0.12 } } : {}),
      tracks: [{ clips: [label] }, { clips: words }, { clips: captions }, { clips: voice }, ...(visualClips.length ? [{ clips: visualClips }] : [])].filter(
        (t) => t.clips.length,
      ),
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  };
}

module.exports = {
  sceneTimings,
  buildSrt,
  buildShotstackEdit,
  estimateMs,
  srtTime,
  wordChunks,
  captionCues,
  planShots,
  DEFAULT_FONT_URL,
  MAX_SHOT_SEC,
  INTRO_SEC,
};
