// Copies the ZXing decoder WASM (used by the camera barcode scanner on iOS Safari and other browsers
// without a native BarcodeDetector) into public/ so it is served same-origin instead of from a CDN.
// Runs before `next dev` / `next build`; the output is git-ignored and always matches the installed version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Resolve through barcode-detector so we always pick the zxing-wasm build it actually uses
const fromDetector = createRequire(require.resolve("barcode-detector/ponyfill"));
const wasm = fromDetector.resolve("zxing-wasm/reader/zxing_reader.wasm");
const outDir = join(root, "public", "vendor", "zxing");
mkdirSync(outDir, { recursive: true });
copyFileSync(wasm, join(outDir, "zxing_reader.wasm"));
console.log(`copied ${wasm} -> public/vendor/zxing/zxing_reader.wasm`);
