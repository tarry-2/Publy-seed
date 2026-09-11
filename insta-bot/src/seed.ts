import { chromium, BrowserContext, Page } from "playwright";
import { ProxyConfig as PxConfig, getProxyForNationality, stickifyDataImpulse, maskProxy } from "./proxy";

/* ───────────────────────────────────────────────────────────
   🌱 골든시드 인스타 조회 시딩 (무계정) — 유튜브 seedView 패턴 이식.
   게이트웨이 referrer(인스타 앱 내부/페북 경유) + 인앱 UA + 게시물/릴스 체류.
   ⚠️ 인스타는 유튜브와 달리 비로그인 시 '로그인 벽(wall)'이 뜰 수 있다.
      게이트웨이 referrer로 "소셜 내부 유입"처럼 진입 시도 + 벽이 떠도 체류는 수행.
      실제 조회 카운트 반영은 로그인 계정(STEP2)이 붙어야 확실. 지금은 진입·체류까지.
─────────────────────────────────────────────────────────── */

export interface ProxyConfig { server: string; username?: string; password?: string; }

// 게이트웨이 referrer — "소셜에서 넘어온 유입"으로 둔갑(밴 회피 핵심).
const GATEWAY_REFERRER: Record<string, string> = {
  instagram: "https://l.instagram.com/",
  facebook: "https://lm.facebook.com/",
  direct: "",
};
// 인앱 UA — 안드 크롬 기반(UA/엔진 일치). 인스타 인앱 토큰 포함.
const GATEWAY_UA: Record<string, string> = {
  instagram: "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 302.0.0.0.0 Android",
  facebook: "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/456.0.0.0]",
  direct: "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-http2", // 🔴 프록시 경유 시 HTTP/2 hang 방지(유튜브에서 실측 확정, 메타도 동일 예방)
];

const ANTI_DETECTION = `
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  if(!window.chrome){window.chrome={runtime:{}};}
  Object.defineProperty(navigator,'languages',{get:()=>['ko-KR','ko','en-US','en']});
`;

function humanDelayMs(minSec: number, maxSec: number): number {
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mid = (minSec + maxSec) / 2, sd = (maxSec - minSec) / 4;
  return Math.max(minSec, Math.min(maxSec, mid + z * sd)) * 1000;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newContext(opts: { gateway: string; proxy?: ProxyConfig; headful?: boolean }): Promise<{ browser: any; context: BrowserContext }> {
  const ua = GATEWAY_UA[opts.gateway] || GATEWAY_UA.direct;
  const browser = await chromium.launch({
    headless: opts.headful === false,
    args: LAUNCH_ARGS,
    slowMo: 30,
    proxy: opts.proxy ? { server: opts.proxy.server, username: opts.proxy.username, password: opts.proxy.password } : undefined,
  });
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.6,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  await context.addInitScript(ANTI_DETECTION);
  return { browser, context };
}

// 로그인 벽/쿠키 팝업 정리(있으면)
async function dismissWall(page: Page) {
  const labels = ["Allow all cookies", "모든 쿠키 허용", "Accept", "동의", "나중에", "Not Now", "닫기"];
  for (const t of labels) {
    try {
      const btn = page.locator(`button:has-text("${t}"), div[role="button"]:has-text("${t}")`).first();
      if (await btn.isVisible({ timeout: 700 }).catch(() => false)) { await btn.click({ timeout: 1000 }).catch(() => {}); await page.waitForTimeout(400); }
    } catch {}
  }
}

// ── 인스타 조회 시딩(무계정) — 게이트웨이 referrer + 게시물/릴스 체류 ──
export async function seedInstaView(params: {
  postUrl: string;
  contentType: "post" | "reels" | "story";
  gateway: "instagram" | "facebook" | "direct";
  nationality?: "kr" | "foreign";
  proxy?: ProxyConfig;
  headful?: boolean;
  watchSeconds?: number;   // 체류 목표 초(기본 30)
  onLog: (msg: string) => void;
  stopSignal: () => boolean;
}): Promise<{ status: "success" | "fail"; watchedSeconds: number; error?: string }> {
  const { postUrl, contentType, gateway, nationality = "kr", onLog, stopSignal } = params;
  const referer = GATEWAY_REFERRER[gateway] || "";

  onLog(`[1/7] 🌐 프록시 준비 — ${nationality === "kr" ? "🇰🇷 한국" : "🌍 해외"} IP 조회 중…`);
  let proxy: PxConfig | null = params.proxy || (await getProxyForNationality(nationality));
  proxy = stickifyDataImpulse(proxy);
  if (proxy) onLog(`[2/7] 🔒 프록시 사용 — 내 실제 IP를 가리고 ${maskProxy(proxy)} 로 접속(방문 동안 IP 고정)`);
  else onLog(`[2/7] ⚠️ 프록시 미배정 — 내 실제 IP로 접속(차단 위험). gs_proxies에 등록하면 안전해져요`);

  const { browser, context } = await newContext({ gateway, proxy: proxy || undefined, headful: params.headful });
  const page = await context.newPage();
  let watched = 0;
  try {
    const gwLabel = gateway === "instagram" ? "인스타" : gateway === "facebook" ? "페북" : "직접";
    const ctLabel = contentType === "reels" ? "릴스" : contentType === "story" ? "스토리" : "게시물";
    onLog(`[3/7] 🧭 게이트웨이 = ${gwLabel} referrer(${referer || "없음"}) + 인앱 UA — "소셜에서 넘어온 유입"으로 위장`);
    onLog(`[4/7] ▶️ ${ctLabel} 진입 중…`);
    const gotoOnce = () => page.goto(postUrl, { waitUntil: "commit", timeout: 60000, referer: referer || undefined });
    try { await gotoOnce(); } catch (e: any) { onLog(`  ⚠️ 진입 지연(프록시 응답 느림) — 재시도… (${String(e?.message || e).split("\n")[0]})`); await gotoOnce(); }
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    onLog(`[5/7] 📄 페이지 로드됨 — 팝업/로그인 벽 정리 중…`);
    await page.waitForTimeout(humanDelayMs(1.5, 3));
    await dismissWall(page);

    // 로그인 벽 감지(참고 로그) — 떠도 체류는 수행(진입 신호)
    const wall = await page.locator('text=/Log in|로그인|Sign up|가입/i').first().isVisible({ timeout: 1500 }).catch(() => false);
    if (wall) onLog(`  ⚠️ 인스타 로그인 벽 감지 — 진입·체류는 수행하나, 조회 카운트는 계정 연결(STEP2) 후 확실해져요`);

    const target = params.watchSeconds ?? 30;
    onLog(`[6/7] ⏱️ ${ctLabel} 체류 시딩 — 목표 ${target}s (첫 구간 이탈 방지) 시작`);
    let elapsed = 0;
    while (elapsed < target) {
      if (stopSignal()) { onLog(`  ⏹ 중단 신호 감지 — 이번 방문 정리`); break; }
      const chunk = Math.min(target - elapsed, 8 + Math.random() * 12);
      await sleep(chunk * 1000);
      elapsed += chunk; watched = Math.round(elapsed);
      if (Math.random() < 0.4) await page.mouse.wheel(0, 100 + Math.random() * 200).catch(() => {}); // 릴스 스크롤/피드 느낌
      onLog(`  ⏱️ 체류 ${watched}/${target}s (${Math.round((watched / target) * 100)}%)`);
    }

    onLog(`[7/7] ✅ 인스타 시딩 완료 — 체류 ${watched}s (velocity 1건 확보)`);
    await browser.close().catch(() => {});
    return { status: "success", watchedSeconds: watched };
  } catch (e: any) {
    await browser.close().catch(() => {});
    onLog(`❌ 인스타 시딩 실패: ${e.message}`);
    return { status: "fail", watchedSeconds: watched, error: e.message };
  }
}
