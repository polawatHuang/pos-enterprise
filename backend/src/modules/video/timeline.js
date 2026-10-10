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

/**
 * Shotstack edit: 1080x1920 mp4 with visuals (AI clip or product image with slow zoom),
 * voice-over per scene, on-screen captions and an "AI-generated" label (platform AIGC rules).
 * @param {{scenes:object[], timings:object[], voiceUrls:string[], visuals:({type:'video'|'image', url:string}|null)[], fontUrl?:string, musicUrl?:string}} p
 */
function buildShotstackEdit({ scenes, timings, voiceUrls, visuals, fontUrl = DEFAULT_FONT_URL, musicUrl = null }) {
  const total = timings.length ? timings.at(-1).start + timings.at(-1).length : 0;
  const css = (size) =>
    `p { font-family: 'Sarabun'; font-weight: 700; color: #ffffff; font-size: ${size}px; text-align: center; line-height: 1.25;` +
    ' text-shadow: 0 4px 16px rgba(0,0,0,0.85); }';
  const captions = scenes
    .map((s, i) =>
      s.caption
        ? {
            asset: { type: 'html', html: `<p>${escapeHtml(s.caption)}</p>`, css: css(76), width: 960, height: 400 },
            start: timings[i].start,
            length: timings[i].length,
            position: 'center',
            offset: { y: 0.28 },
            transition: { in: 'fade', out: 'fade' },
          }
        : null,
    )
    .filter(Boolean);
  const label = {
    asset: { type: 'html', html: '<p>สร้างด้วย AI</p>', css: css(30).replace('#ffffff', '#f1f5f9'), width: 360, height: 80 },
    start: 0,
    length: Math.max(0.1, total),
    position: 'topLeft',
    offset: { x: 0.03, y: -0.03 },
    opacity: 0.85,
  };
  const visualClips = visuals
    .map((v, i) => {
      if (!v) return null;
      const base = { start: timings[i].start, length: timings[i].length, fit: 'crop', transition: { in: 'fade' } };
      return v.type === 'video'
        ? { ...base, asset: { type: 'video', src: v.url, volume: 0 } }
        : { ...base, asset: { type: 'image', src: v.url }, effect: i % 2 ? 'zoomOutSlow' : 'zoomInSlow' };
    })
    .filter(Boolean);
  const voice = voiceUrls.map((url, i) => ({ asset: { type: 'audio', src: url, volume: 1 }, start: timings[i].start, length: timings[i].length }));

  return {
    timeline: {
      background: '#111827',
      fonts: [{ src: fontUrl }],
      ...(musicUrl ? { soundtrack: { src: musicUrl, effect: 'fadeInFadeOut', volume: 0.12 } } : {}),
      tracks: [{ clips: [label] }, { clips: captions }, { clips: voice }, ...(visualClips.length ? [{ clips: visualClips }] : [])].filter((t) => t.clips.length),
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  };
}

module.exports = { sceneTimings, buildSrt, buildShotstackEdit, estimateMs, srtTime, DEFAULT_FONT_URL };
