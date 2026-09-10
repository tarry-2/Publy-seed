// 로그인 화면(5173)을 라이트/다크로 캡처해 가독성 눈으로 확인.
import { writeFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const pwPath = join(here, "..", "youtube-bot", "node_modules", "playwright", "index.mjs");
const { chromium } = await import(pathToFileURL(pwPath).href);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });

for (const theme of ["light", "dark"]) {
  await page.addInitScript((t) => { localStorage.setItem("publy_theme", t); }, theme);
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const buf = await page.screenshot();
  writeFileSync(join(here, `login-${theme}.png`), buf);
  console.log(`✅ login-${theme}.png`);
}
await browser.close();
