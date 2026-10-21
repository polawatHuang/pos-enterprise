"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { AlertTriangle, Camera, CheckCircle2, ImageUp, Loader2, RefreshCw, SwitchCamera, X, XCircle, Zap, ZapOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { beep as playBeep } from "@/components/pos/sound";

/*
 * Camera barcode scanning for phones and tablets.
 *
 * Decoder: the browser's native BarcodeDetector when it supports retail formats (Chrome on Android),
 * otherwise ZXing compiled to WASM via the `barcode-detector` ponyfill (iOS Safari, Firefox, desktop).
 * The ponyfill and its WASM are loaded only when a scanner opens; the WASM is served same-origin from
 * /vendor/zxing (copied by scripts/copy-zxing-wasm.mjs), falling back to the jsDelivr CDN if missing.
 */

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"] as const;
const LOCAL_WASM = "/vendor/zxing/zxing_reader.wasm";

interface DetectedLike {
  rawValue: string;
  format?: string;
}
interface Detector {
  detect(source: HTMLCanvasElement | HTMLImageElement | ImageBitmap): Promise<DetectedLike[]>;
}
interface NativeDetectorCtor {
  new (opts?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
}

let zxingPromise: Promise<Detector> | null = null;
/** ZXing (WASM) detector, created once per page and reused by every scanner. */
function loadZxing(): Promise<Detector> {
  zxingPromise ??= (async () => {
    const m = await import("barcode-detector/ponyfill");
    const local = await fetch(LOCAL_WASM, { method: "HEAD" })
      .then((r) => r.ok)
      .catch(() => false);
    const overrides = local
      ? { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `${LOCAL_WASM}?v=${m.ZXING_WASM_VERSION}` : prefix + path) }
      : {};
    // Fire now so a failed WASM download surfaces here (and is retried next time) instead of on every frame
    await m.prepareZXingModule({ overrides, fireImmediately: true });
    return new m.BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detector;
  })().catch((err: unknown) => {
    zxingPromise = null;
    throw err;
  });
  return zxingPromise;
}

let nativePromise: Promise<Detector | null> | null = null;
/** Native Shape Detection API, only when it can read the retail formats we need. */
function loadNative(): Promise<Detector | null> {
  nativePromise ??= (async () => {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (!Ctor?.getSupportedFormats) return null;
    try {
      const supported = await Ctor.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (!formats.includes("ean_13") || !formats.includes("code_128")) return null;
      return new Ctor({ formats });
    } catch {
      return null;
    }
  })();
  return nativePromise;
}

async function loadDetector(): Promise<{ detector: Detector; native: boolean }> {
  const native = await loadNative();
  return native ? { detector: native, native: true } : { detector: await loadZxing(), native: false };
}

/** UPC-A (12 digits) back to its 8-digit UPC-E form; the code came from a UPC-E symbol, so it always compresses. */
function upcAToE(a: string): string | null {
  if (!/^[01]\d{11}$/.test(a)) return null;
  const [n, m, p, c] = [a[0], a.slice(1, 6), a.slice(6, 11), a[11]];
  if (m.slice(3) === "00" && "012".includes(m[2]) && p.startsWith("00")) return n + m.slice(0, 2) + p.slice(2) + m[2] + c;
  if (m.slice(3) === "00" && p.startsWith("000")) return n + m.slice(0, 3) + p.slice(3) + "3" + c;
  if (m[4] === "0" && p.startsWith("0000")) return n + m.slice(0, 4) + p[4] + "4" + c;
  if (p.startsWith("0000") && p[4] >= "5") return n + m + p[4] + c;
  return null;
}

/**
 * Same text Android's native detector (and a USB scanner in its default setup) gives, so a product reads
 * the same on every phone: ZXing reports UPC-A as a 13-digit EAN-13 with a leading "0" (an EAN-13 starting
 * with 0 *is* a UPC-A) and UPC-E expanded to that form. Thai EAN-13 codes (885…) are untouched.
 */
function normalize(f: DetectedLike): string {
  const v = f.rawValue?.trim() ?? "";
  if (!/^0\d{12}$/.test(v)) return v;
  if (f.format === "upc_e") return upcAToE(v.slice(1)) ?? v;
  if (f.format === "upc_a" || f.format === "ean_13") return v.slice(1);
  return v;
}

const firstCode = (found: DetectedLike[]) => found.map(normalize).find((v) => !!v) ?? null;

/** Decode a still photo (camera capture or gallery). Tries a few sizes: phones produce 12MP+ images. */
export async function decodeBarcodeFromFile(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const { detector, native } = await loadDetector();
    const detectors = native ? [detector, await loadZxing().catch(() => null)] : [detector];
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    for (const target of [...new Set([1600, 2600, longest])].filter((t) => t <= longest)) {
      const scale = Math.min(1, target / longest);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const d of detectors) {
        if (!d) continue;
        const code = firstCode(await d.detect(canvas).catch(() => []));
        if (code) return code;
      }
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------ errors */

type ErrorKind = "insecure" | "unsupported" | "denied" | "nocamera" | "busy" | "engine" | "ended";
const isIOS = () =>
  typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

function cameraErrorKind(err: unknown): ErrorKind {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "nocamera";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return "unsupported";
}

function ErrorHelp({ kind }: { kind: ErrorKind }) {
  const ios = isIOS();
  const title: Record<ErrorKind, string> = {
    insecure: "กล้องใช้ได้เฉพาะเว็บที่เป็น HTTPS",
    unsupported: "เบราว์เซอร์นี้เปิดกล้องไม่ได้",
    denied: "ยังไม่ได้อนุญาตให้ใช้กล้อง",
    nocamera: "ไม่พบกล้องบนอุปกรณ์นี้",
    busy: "กล้องถูกใช้งานอยู่",
    engine: "โหลดตัวอ่านบาร์โค้ดไม่สำเร็จ",
    ended: "กล้องหยุดทำงาน",
  };
  return (
    <div className="mx-auto max-w-sm space-y-3 text-sm leading-relaxed text-white/85">
      <p className="flex items-center gap-2 text-base font-semibold text-white">
        <AlertTriangle className="size-5 shrink-0 text-warning" /> {title[kind]}
      </p>
      {kind === "insecure" && <p>เบราว์เซอร์อนุญาตให้ใช้กล้องสดเฉพาะเมื่อเปิดเว็บผ่าน https:// เท่านั้น ระหว่างนี้ใช้ปุ่ม “ถ่ายรูปบาร์โค้ด” ด้านล่างแทนได้</p>}
      {kind === "unsupported" && <p>ลองเปิดด้วย Safari (iPhone/iPad) หรือ Chrome (Android) เวอร์ชันล่าสุด หรือใช้ปุ่ม “ถ่ายรูปบาร์โค้ด” ด้านล่าง</p>}
      {kind === "denied" && (
        <>
          <p>อนุญาตการใช้กล้องให้เว็บนี้ แล้วกด “ลองใหม่”</p>
          <ul className={cn("list-disc space-y-1.5 pl-5", !ios && "flex flex-col-reverse")}>
            <li>
              <b>iPhone / iPad (Safari):</b> แตะปุ่ม <b>aA</b> หรือไอคอนข้างช่องที่อยู่เว็บ → <b>การตั้งค่าเว็บไซต์</b> → <b>กล้อง</b> → <b>อนุญาต</b> (หรือ
              แอปการตั้งค่า → Safari → กล้อง → อนุญาต) แล้วโหลดหน้าใหม่
            </li>
            <li>
              <b>Android (Chrome):</b> แตะไอคอนข้างช่องที่อยู่เว็บ → <b>สิทธิ์</b> → <b>กล้อง</b> → <b>อนุญาต</b> แล้วโหลดหน้าใหม่ หากยังไม่ได้ ให้ไปที่
              การตั้งค่าเครื่อง → แอป → Chrome → สิทธิ์ → กล้อง
            </li>
          </ul>
        </>
      )}
      {kind === "nocamera" && <p>ใช้เครื่องสแกนบาร์โค้ด พิมพ์รหัส หรือเลือกรูปบาร์โค้ดจากเครื่องแทน</p>}
      {kind === "busy" && <p>ปิดแอปหรือแท็บอื่นที่กำลังใช้กล้อง (เช่น แอปกล้อง วิดีโอคอล) แล้วกด “ลองใหม่”</p>}
      {kind === "engine" && <p>ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วกด “ลองใหม่”</p>}
      {kind === "ended" && <p>กล้องถูกปิดไป (เช่น สลับแอปหรือล็อกหน้าจอ) กด “ลองใหม่” เพื่อเปิดอีกครั้ง</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ scanner */

export type ScanMode = "single" | "continuous";
/**
 * Called with each accepted code. In continuous mode the scanner shows the result in its list:
 * return a string (e.g. the product name) to label it, or `false` / throw to mark it as not found.
 */
export type ScanHandler = (code: string) => unknown;

interface Hit {
  id: number;
  code: string;
  state: "pending" | "ok" | "error";
  label?: string;
}

/** Same code is ignored for this long after it was accepted, and until it has left the frame briefly. */
const DEDUPE_MS = 1500;
const ABSENT_MS = 450;

function BarcodeScanner({
  mode,
  title,
  beep,
  onDetected,
  onClose,
}: {
  mode: ScanMode;
  title: string;
  beep: boolean;
  onDetected: ScanHandler;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const handlerRef = useRef(onDetected);
  useLayoutEffect(() => {
    handlerRef.current = onDetected;
  });
  const last = useRef({ code: "", acceptedAt: 0, seenAt: 0 });
  const doneRef = useRef(false);
  const hitId = useRef(0);

  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [error, setError] = useState<ErrorKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const [hits, setHits] = useState<Hit[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback((kind: ErrorKind) => {
    setError(kind);
    setStatus("error");
  }, []);

  /** Accept a code: feedback, hand it to the page, then close (single) or keep going (continuous). */
  const accept = useCallback(
    (code: string) => {
      if (doneRef.current) return;
      if ("vibrate" in navigator) navigator.vibrate?.(60);
      if (beep) playBeep("ok");
      if (mode === "single") {
        doneRef.current = true;
        handlerRef.current(code);
        onClose();
        return;
      }
      const id = ++hitId.current;
      setNotice(null);
      setHits((h) => [{ id, code, state: "pending" as const }, ...h].slice(0, 30));
      Promise.resolve()
        .then(() => handlerRef.current(code))
        .then(
          (r) => setHits((h) => h.map((x) => (x.id === id ? { ...x, state: r === false ? "error" : "ok", label: typeof r === "string" ? r : undefined } : x))),
          () => setHits((h) => h.map((x) => (x.id === id ? { ...x, state: "error" } : x))),
        );
    },
    [beep, mode, onClose],
  );
  const acceptRef = useRef(accept);
  useLayoutEffect(() => {
    acceptRef.current = accept;
  });

  /* Camera + decode loop. Restarts when the camera is switched or the user retries. */
  useEffect(() => {
    let alive = true;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Read lazily: the dialog portal mounts its children after this effect first runs
    let video: HTMLVideoElement | null = null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const stop = () => {
      alive = false;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      trackRef.current = null;
      if (video) video.srcObject = null;
    };

    /** Copy only the region under the scan box (plus margin) — faster decoding and no stray codes nearby. */
    const grab = (): HTMLCanvasElement | null => {
      const box = boxRef.current;
      if (!video || !ctx || !box || video.readyState < 2 || !video.videoWidth) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const vr = video.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      const s = Math.max(vr.width / vw, vr.height / vh); // object-cover scale
      const ox = (vw * s - vr.width) / 2;
      const oy = (vh * s - vr.height) / 2;
      const pad = 0.12;
      let sx = (br.left - vr.left + ox) / s - (br.width / s) * pad;
      let sy = (br.top - vr.top + oy) / s - (br.height / s) * pad;
      let sw = (br.width / s) * (1 + 2 * pad);
      let sh = (br.height / s) * (1 + 2 * pad);
      sx = Math.max(0, sx);
      sy = Math.max(0, sy);
      sw = Math.min(vw - sx, sw);
      sh = Math.min(vh - sy, sh);
      if (sw < 16 || sh < 16) return null;
      const k = Math.min(1, 1280 / sw);
      canvas.width = Math.round(sw * k);
      canvas.height = Math.round(sh * k);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas;
    };

    const start = async () => {
      if (!window.isSecureContext) return fail("insecure");
      if (!navigator.mediaDevices?.getUserMedia) return fail("unsupported");
      const detectorP = loadDetector(); // download WASM while the camera warms up
      const constraints: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints }).catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "OverconstrainedError") return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          throw err;
        });
      } catch (err) {
        if (alive) fail(cameraErrorKind(err));
        return;
      }
      if (!alive) return stream.getTracks().forEach((t) => t.stop());
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      track.addEventListener("ended", () => alive && fail("ended"));
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      setTorch({ supported: !!caps.torch, on: false });
      if (caps.focusMode?.includes("continuous"))
        void track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => alive && setCameras(list.filter((d) => d.kind === "videoinput" && d.deviceId)))
        .catch(() => {});
      video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      let detector: Detector;
      let native: boolean;
      try {
        ({ detector, native } = await detectorP);
      } catch {
        if (alive) fail("engine");
        return;
      }
      if (!alive) return;
      setStatus("scanning");
      const tick = async () => {
        if (!alive) return;
        const frame = document.hidden ? null : grab();
        if (frame) {
          const code = firstCode(await detector.detect(frame).catch(() => []));
          const now = performance.now();
          if (code && alive) {
            const l = last.current;
            const fresh = code !== l.code || (now - l.acceptedAt >= DEDUPE_MS && now - l.seenAt >= ABSENT_MS);
            if (fresh) last.current = { code, acceptedAt: now, seenAt: now };
            else l.seenAt = now;
            if (fresh) acceptRef.current(code);
          }
        }
        if (alive) timer = setTimeout(() => void tick(), native ? 90 : 130);
      };
      void tick();
    };

    void start();
    return stop;
  }, [deviceId, attempt, fail]);

  /* iOS can kill the camera when the app is backgrounded; restart when the page comes back. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && trackRef.current?.readyState === "ended") {
        setStatus("starting");
        setError(null);
        setAttempt((a) => a + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const retry = () => {
    setStatus("starting");
    setError(null);
    setAttempt((a) => a + 1);
  };

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ supported: true, on });
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const current = trackRef.current?.getSettings().deviceId ?? deviceId;
    const i = cameras.findIndex((c) => c.deviceId === current);
    setStatus("starting");
    setDeviceId(cameras[(i + 1) % cameras.length].deviceId);
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setNotice(null);
    try {
      const code = await decodeBarcodeFromFile(file);
      if (code) {
        last.current = { code, acceptedAt: performance.now(), seenAt: performance.now() };
        accept(code);
      } else {
        if (beep) playBeep("error");
        setNotice("ไม่พบบาร์โค้ดในรูป — ถ่ายให้ใกล้ขึ้น ให้บาร์โค้ดชัด ไม่เอียง และมีแสงพอ");
      }
    } catch {
      setNotice("อ่านรูปไม่สำเร็จ ลองถ่ายใหม่อีกครั้ง");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const okCount = hits.filter((h) => h.state !== "error").length;

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/70" />
      <DialogPrimitive.Content
        className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-black text-white outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(680px,92dvh)] sm:w-[min(560px,calc(100%-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:shadow-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Rendered in a portal, but React still bubbles events to the page that owns the button (forms, palettes)
        onKeyDown={(e) => e.stopPropagation()}
        data-testid="barcode-scanner"
      >
        <div className="flex items-center gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1 pl-1">
            <DialogPrimitive.Title className="truncate text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-xs text-white/60">
              {mode === "continuous" ? "สแกนต่อเนื่อง — เล็งทีละชิ้น ระบบรับรหัสให้อัตโนมัติ" : "เล็งบาร์โค้ดให้อยู่ในกรอบ"}
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="ปิดกล้อง">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <video
            ref={videoRef}
            className={cn("absolute inset-0 size-full object-cover", status === "error" && "invisible")}
            muted
            playsInline
            autoPlay
            aria-hidden
          />

          {status !== "error" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div ref={boxRef} className="relative aspect-[1.6] w-[min(82%,420px)] max-h-[70%] rounded-2xl shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]">
                {(
                  [
                    "left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl",
                    "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl",
                    "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl",
                    "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl",
                  ] as const
                ).map((c) => (
                  <span key={c} className={cn("absolute size-8 border-white", c)} />
                ))}
                {status === "scanning" && (
                  <span className="absolute inset-x-3 h-0.5 animate-[scan-line_2.2s_ease-in-out_infinite] rounded-full bg-danger shadow-[0_0_12px_3px] shadow-danger/70" />
                )}
              </div>
            </div>
          )}

          {status === "starting" && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm">
                <Loader2 className="size-4 animate-spin" /> กำลังเปิดกล้อง...
              </p>
            </div>
          )}

          {status === "error" && error && (
            <div className="absolute inset-0 overflow-y-auto p-5 pb-24 pt-8">
              <ErrorHelp kind={error} />
              <div className="mx-auto mt-5 flex max-w-sm gap-2">
                {error !== "insecure" && error !== "nocamera" && (
                  <Button type="button" variant="secondary" className="h-11 flex-1" onClick={retry}>
                    <RefreshCw /> ลองใหม่
                  </Button>
                )}
              </div>
            </div>
          )}

          {mode === "continuous" && hits[0] && (
            <div
              key={hits[0].id}
              className={cn(
                "absolute inset-x-4 top-3 flex animate-[pos-flash_0.6s_ease-out] items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium shadow-lg",
                hits[0].state === "error" ? "bg-danger text-white" : "bg-white text-black",
              )}
              role="status"
            >
              {hits[0].state === "pending" ? (
                <Loader2 className="size-5 shrink-0 animate-spin" />
              ) : hits[0].state === "ok" ? (
                <CheckCircle2 className="size-5 shrink-0 text-success" />
              ) : (
                <XCircle className="size-5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{hits[0].label ?? hits[0].code}</span>
              {hits[0].label && <span className="shrink-0 font-mono text-xs opacity-60">{hits[0].code}</span>}
            </div>
          )}

          {notice && (
            <p className="absolute inset-x-4 bottom-20 rounded-xl bg-warning px-3 py-2 text-sm font-medium text-black shadow-lg" role="alert">
              {notice}
            </p>
          )}

          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3">
            {torch.supported && status === "scanning" && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                className={cn("grid size-12 place-items-center rounded-full backdrop-blur", torch.on ? "bg-warning text-black" : "bg-black/50 text-white")}
                aria-label={torch.on ? "ปิดไฟฉาย" : "เปิดไฟฉาย"}
                aria-pressed={torch.on}
              >
                {torch.on ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              className={cn(
                "flex h-12 items-center gap-2 rounded-full px-4 text-sm font-medium backdrop-blur disabled:opacity-60",
                status === "error" ? "bg-white text-black" : "bg-black/50",
              )}
            >
              {photoBusy ? <Loader2 className="size-5 animate-spin" /> : <ImageUp className="size-5" />} ถ่ายรูปบาร์โค้ด
            </button>
            {cameras.length > 1 && status !== "error" && (
              <button
                type="button"
                onClick={switchCamera}
                className="grid size-12 place-items-center rounded-full bg-black/50 backdrop-blur"
                aria-label="สลับกล้อง"
              >
                <SwitchCamera className="size-5" />
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onPhoto(e.target.files?.[0])}
            aria-hidden
            tabIndex={-1}
          />
        </div>

        {mode === "continuous" && (
          <div className="border-t border-white/10 bg-neutral-950 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            {hits.length > 1 && (
              <ul className="mb-2 max-h-28 space-y-1 overflow-y-auto text-sm" aria-label="รายการที่สแกนแล้ว">
                {hits.slice(1, 12).map((h) => (
                  <li key={h.id} className={cn("flex items-center gap-2", h.state === "error" ? "text-danger" : "text-white/75")}>
                    {h.state === "error" ? <XCircle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0 text-success" />}
                    <span className="min-w-0 flex-1 truncate">{h.label ?? h.code}</span>
                    <span className="shrink-0 font-mono text-xs opacity-60">{h.code}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-white/70">{hits.length ? `สแกนแล้ว ${okCount} ครั้ง` : "ยังไม่ได้สแกน"}</p>
              <DialogPrimitive.Close asChild>
                <Button type="button" className="h-11 px-6">
                  เสร็จสิ้น
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
        )}
        {mode === "single" && <div className="pb-[env(safe-area-inset-bottom)]" />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * Camera icon button that opens a full-screen (mobile) / dialog (desktop) barcode scanner.
 * Feed `onDetected` into the same handler the text input uses on Enter, so USB/Bluetooth scanners keep working.
 */
export function ScanButton({
  onDetected,
  mode = "single",
  title = "สแกนบาร์โค้ดด้วยกล้อง",
  beep = true,
  disabled,
  className,
  variant = "outline",
}: {
  onDetected: ScanHandler;
  mode?: ScanMode;
  title?: string;
  /** Play a beep on each detection. Turn off when the handler already beeps (e.g. POS, stock count). */
  beep?: boolean;
  disabled?: boolean;
  className?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
}) {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          type="button"
          variant={variant}
          disabled={disabled}
          className={cn("size-11 shrink-0 p-0 [&_svg]:size-5", className)}
          aria-label={title}
          title={title}
        >
          <Camera />
        </Button>
      </DialogPrimitive.Trigger>
      {open && <BarcodeScanner mode={mode} title={title} beep={beep} onDetected={onDetected} onClose={() => setOpen(false)} />}
    </DialogPrimitive.Root>
  );
}
