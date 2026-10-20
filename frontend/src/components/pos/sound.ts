let ctx: AudioContext | null = null;

/** Short scanner-style beep (WebAudio; no audio files). Errors use a lower, longer tone. */
export function beep(kind: "ok" | "error" | "done" = "ok") {
  if (typeof window === "undefined") return;
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = kind === "ok" ? 1760 : kind === "done" ? 1320 : 220;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(ctx.destination);
    const t = ctx.currentTime;
    osc.start(t);
    osc.stop(t + (kind === "error" ? 0.25 : kind === "done" ? 0.18 : 0.07));
    if (kind === "error" && "vibrate" in navigator) navigator.vibrate(120);
  } catch {
    // audio is a nicety; never break a sale over it
  }
}
