// public/icon-1024.png → public/icon.ico (PNG-in-ICO, Vista+ 지원).
// sips로 각 크기 png 생성 후 ICO 컨테이너로 조합. ImageMagick 불필요.
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "public", "icon-1024.png");
const tmp = join(here, ".ico-tmp");
const sizes = [16, 32, 48, 64, 128, 256];

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const entries = sizes.map((s) => {
  const out = join(tmp, `${s}.png`);
  execFileSync("sips", ["-z", String(s), String(s), src, "--out", out], { stdio: "ignore" });
  return { size: s, data: readFileSync(out) };
});

// ICONDIR
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            // reserved
header.writeUInt16LE(1, 2);            // type = icon
header.writeUInt16LE(entries.length, 4);

const dirEntries = [];
let offset = 6 + entries.length * 16;
for (const e of entries) {
  const de = Buffer.alloc(16);
  de.writeUInt8(e.size >= 256 ? 0 : e.size, 0);  // width (0 = 256)
  de.writeUInt8(e.size >= 256 ? 0 : e.size, 1);  // height
  de.writeUInt8(0, 2);                            // color palette
  de.writeUInt8(0, 3);                            // reserved
  de.writeUInt16LE(1, 4);                         // color planes
  de.writeUInt16LE(32, 6);                        // bpp
  de.writeUInt32LE(e.data.length, 8);            // size
  de.writeUInt32LE(offset, 12);                  // offset
  offset += e.data.length;
  dirEntries.push(de);
}

const ico = Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.data)]);
writeFileSync(join(here, "..", "public", "icon.ico"), ico);
rmSync(tmp, { recursive: true, force: true });
console.log("✅ icon.ico 생성:", ico.length, "bytes,", entries.length, "sizes");
