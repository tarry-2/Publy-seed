// 골든시드 아이콘 SVG → PNG(1024) 렌더 (Playwright chromium).
// rsvg/magick 없이 브라우저로 정확히 래스터화한다.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
// playwright는 youtube-bot에만 설치됨 → 절대경로로 dynamic import(ESM은 NODE_PATH 무시).
const pwPath = join(here, "..", "youtube-bot", "node_modules", "playwright", "index.mjs");
const { chromium } = await import(pathToFileURL(pwPath).href);
const svg = readFileSync(join(here, "icon-source.svg"), "utf8");
const out = join(here, "..", "public", "icon-1024.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(
  `<!doctype html><html><head><style>*{margin:0;padding:0}html,body{width:1024px;height:1024px;overflow:hidden}</style></head><body>${svg}</body></html>`,
  { waitUntil: "networkidle" }
);
await page.waitForTimeout(300); // 폰트 적용 대기
const el = await page.$("svg");
const buf = await el.screenshot({ omitBackground: true });
writeFileSync(out, buf);
await browser.close();
console.log("✅ 렌더 완료 →", out, buf.length, "bytes");
