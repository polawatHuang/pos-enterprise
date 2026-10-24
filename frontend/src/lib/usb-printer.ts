/**
 * The till's thermal printer over WebUSB (or Web Serial for printers that show up as a COM port).
 * Works in Chrome/Edge on Windows, macOS and Android; elsewhere `printerSupport()` is "none" and
 * the POS keeps using the browser's print dialog. Settings are per device (localStorage).
 */
import { CMD, type PaperWidth } from "./escpos";

// Minimal shapes of the WebUSB / Web Serial APIs we use (not in TypeScript's DOM lib)
interface UsbEndpoint {
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
  endpointNumber: number;
}
interface UsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  opened: boolean;
  configuration: { interfaces: { interfaceNumber: number; alternate: { endpoints: UsbEndpoint[] } }[] } | null;
  open(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<unknown>;
}
interface Usb {
  requestDevice(o: { filters: object[] }): Promise<UsbDevice>;
  getDevices(): Promise<UsbDevice[]>;
}
interface SerialPortLike {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(o: { baudRate: number }): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}
interface Serial {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}
const nav = () => (typeof navigator === "undefined" ? null : (navigator as unknown as { usb?: Usb; serial?: Serial }));

export interface PrinterSettings {
  kind: "usb" | "serial" | null;
  vendorId?: number;
  productId?: number;
  name?: string;
  paper: PaperWidth;
  /** print the receipt by itself after each sale */
  autoPrint: boolean;
  /** kick the cash drawer when cash is taken or moved */
  drawer: boolean;
}
const KEY = "pos.printer";
export const DEFAULT_PRINTER: PrinterSettings = { kind: null, paper: 80, autoPrint: true, drawer: true };

export function loadPrinter(): PrinterSettings {
  try {
    const v = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    return v ? { ...DEFAULT_PRINTER, ...JSON.parse(v) } : DEFAULT_PRINTER;
  } catch {
    return DEFAULT_PRINTER;
  }
}
export function savePrinter(s: PrinterSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings last this visit */
  }
}

export function printerSupport(): "usb" | "serial" | "both" | "none" {
  const n = nav();
  if (n?.usb && n?.serial) return "both";
  return n?.usb ? "usb" : n?.serial ? "serial" : "none";
}

type Conn = { write(data: Uint8Array): Promise<void> };
let conn: { key: string; c: Conn } | null = null;

async function openUsb(d: UsbDevice): Promise<Conn> {
  if (!d.opened) await d.open();
  if (!d.configuration) await d.selectConfiguration(1);
  for (const itf of d.configuration!.interfaces) {
    const out = itf.alternate.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
    if (!out) continue;
    try {
      await d.claimInterface(itf.interfaceNumber);
    } catch {
      /* already claimed by this page */
    }
    return {
      write: async (data) => {
        for (let i = 0; i < data.length; i += 4096) await d.transferOut(out.endpointNumber, data.slice(i, i + 4096));
      },
    };
  }
  throw new Error("เครื่องนี้ไม่ใช่เครื่องพิมพ์ (ไม่พบช่องส่งข้อมูล)");
}

async function openSerial(p: SerialPortLike): Promise<Conn> {
  if (!p.writable) await p.open({ baudRate: 9600 });
  return {
    write: async (data) => {
      const w = p.writable!.getWriter();
      try {
        await w.write(data);
      } finally {
        w.releaseLock();
      }
    },
  };
}

/** Asks the browser to pick a printer (needs a click) and remembers it. */
export async function pairPrinter(kind: "usb" | "serial", current: PrinterSettings): Promise<PrinterSettings> {
  const n = nav();
  conn = null;
  if (kind === "usb") {
    const d = await n!.usb!.requestDevice({ filters: [] });
    await openUsb(d);
    return { ...current, kind, vendorId: d.vendorId, productId: d.productId, name: d.productName || `USB ${d.vendorId.toString(16)}:${d.productId.toString(16)}` };
  }
  const p = await n!.serial!.requestPort();
  await openSerial(p);
  const info = p.getInfo();
  return { ...current, kind, vendorId: info.usbVendorId, productId: info.usbProductId, name: "เครื่องพิมพ์ (Serial)" };
}

async function connection(s: PrinterSettings): Promise<Conn> {
  const key = `${s.kind}:${s.vendorId}:${s.productId}`;
  if (conn?.key === key) return conn.c;
  const n = nav();
  let c: Conn | null = null;
  if (s.kind === "usb" && n?.usb) {
    const d = (await n.usb.getDevices()).find((x) => x.vendorId === s.vendorId && x.productId === s.productId);
    if (d) c = await openUsb(d);
  } else if (s.kind === "serial" && n?.serial) {
    const ports = await n.serial.getPorts();
    const p = ports.find((x) => x.getInfo().usbVendorId === s.vendorId && x.getInfo().usbProductId === s.productId) ?? ports[0];
    if (p) c = await openSerial(p);
  }
  if (!c) throw new Error("ไม่พบเครื่องพิมพ์ — ตรวจสาย USB แล้วกดจับคู่ใหม่");
  conn = { key, c };
  return c;
}

export async function sendToPrinter(s: PrinterSettings, data: Uint8Array) {
  try {
    await (await connection(s)).write(data);
  } catch (err) {
    conn = null; // unplugged / sleeping: reconnect next time
    throw err;
  }
}

export const kickDrawer = (s: PrinterSettings) => sendToPrinter(s, Uint8Array.from(CMD.drawer));
