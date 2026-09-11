import { chromium, BrowserContext, Page } from "playwright";
import path from "path";
import { hasSession, readSession, writeSession } from "./session-store";
import { ProxyConfig as PxConfig, getProxyForNationality, stickifyDataImpulse, maskProxy } from "./proxy";

// ─────────────────────────────────────────────────────────────
//  youtube-bot — 골든시드 유튜브 시딩 (insta-bot 패턴 재활용)
//  STEP1 = 조회 시딩(무계정): 게이트웨이 referrer + watch time.
//  ★ CLAUDE.md 제1원칙: 물량이 아니라 자연스러움. 소량·휴먼딜레이·임계선 밑.
//  ⚠️ 셀렉터/타이밍은 유튜브 UI·지역화에 따라 1회 실측 튜닝 필요(insta-bot도 동일).
//  ⚠️ chromium.launch headless:false — 실제 브라우저 창(설치형 전제).
// ─────────────────────────────────────────────────────────────

const LEGACY_SESSION_DIRS = [path.join(__dirname, "../sessions")];
const sessionName = (accountId: string) => `yt_${accountId}`;
export function ytSessionExists(accountId: string): boolean {
  return hasSession(sessionName(accountId), LEGACY_SESSION_DIRS);
}

// 게이트웨이 referrer — 소셜에서 넘어온 유입으로 둔갑(밴 회피 핵심).
//  유튜브가 referrer를 "소셜 확산 진짜 유입"으로 읽음 → 좋은 신호.
export const GATEWAY_REFERRER: Record<string, string> = {
  instagram: "https://l.instagram.com/",
  facebook: "https://lm.facebook.com/",
  direct: "",
};

// 인앱브라우저 UA — ★안드로이드 크롬 엔진 기반(UA/엔진 일치: 스토어 429 교훈).
//  Chromium 엔진에 iPhone Safari UA를 쓰면 불일치로 차단됨 → 안드 크롬 기반으로 통일.
export const GATEWAY_UA: Record<string, string> = {
  instagram:
    "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 302.0.0.0.0 Android",
  facebook:
    "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/456.0.0.0]",
  direct:
    "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

export interface ProxyConfig {
  server: string; // "http://host:port"
  username?: string;
  password?: string;
}

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required", // 자동재생 허용(조회 카운트 확보)
];

const ANTI_DETECTION_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) { window.chrome = { runtime: {} }; }
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US','en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5].map(() => ({ name: 'Chrome PDF Plugin' })) });
`;

// 정규분포 휴먼 딜레이 (초→ms) — insta-bot 재활용 (탐지 회피 핵심)
function humanDelayMs(minSec: number, maxSec: number): number {
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mid = (minSec + maxSec) / 2;
  const sd = (maxSec - minSec) / 4;
  return Math.max(minSec, Math.min(maxSec, mid + z * sd)) * 1000;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 브라우저 컨텍스트 — 게이트웨이별 UA + 프록시 + 모바일 뷰포트 + 안티디텍션
async function newContext(opts: {
  gateway: string;
  proxy?: ProxyConfig;
  withSession?: boolean;
  accountId?: string;
  headful?: boolean;   // 🚪 창 보기(true=창 표시, false=headless)
}): Promise<{ browser: any; context: BrowserContext }> {
  const ua = GATEWAY_UA[opts.gateway] || GATEWAY_UA.direct;
  const browser = await chromium.launch({
    headless: opts.headful === false,   // 창보기 OFF면 headless로(백그라운드), 기본은 창 표시
    args: LAUNCH_ARGS,
    slowMo: 30,
    proxy: opts.proxy
      ? { server: opts.proxy.server, username: opts.proxy.username, password: opts.proxy.password }
      : undefined,
  });
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 412, height: 915 }, // 모바일(안드) 뷰포트
    deviceScaleFactor: 2.6,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    storageState:
      opts.withSession && opts.accountId && ytSessionExists(opts.accountId)
        ? readSession<any>(sessionName(opts.accountId), LEGACY_SESSION_DIRS)
        : undefined,
  });
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
  return { browser, context };
}

// 유튜브 동의/쿠키 팝업 닫기
async function dismissConsent(page: Page) {
  const labels = ["모두 수락", "Accept all", "동의", "나중에", "No thanks", "건너뛰기", "Skip"];
  for (const t of labels) {
    try {
      const btn = page
        .locator(`button:has-text("${t}"), tp-yt-paper-button:has-text("${t}"), yt-button-shape:has-text("${t}")`)
        .first();
      if (await btn.isVisible({ timeout: 700 }).catch(() => false)) {
        await btn.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    } catch {}
  }
}

// 광고 스킵 시도(있으면)
async function trySkipAd(page: Page) {
  try {
    const skip = page
      .locator('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, button:has-text("광고 건너뛰기"), button:has-text("Skip")')
      .first();
    if (await skip.isVisible({ timeout: 1000 }).catch(() => false)) {
      await skip.click({ timeout: 1500 }).catch(() => {});
    }
  } catch {}
}

// 현재 video 요소 재생 강제 + 길이 반환(초)
async function ensurePlaying(page: Page): Promise<number> {
  return await page
    .evaluate(() => {
      const v = document.querySelector("video") as HTMLVideoElement | null;
      if (!v) return 0;
      v.muted = false;
      v.play().catch(() => {});
      return isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    })
    .catch(() => 0);
}

// ── 조회 시딩(무계정) — 게이트웨이 referrer + watch time ──────────
//  쇼츠: 완주+루프(완주율 신호) / 롱폼: 목표 시청초 체류(watch time 신호)
export async function seedView(params: {
  videoUrl: string;
  videoType: "shorts" | "longform";
  gateway: "instagram" | "facebook" | "direct";
  nationality?: "kr" | "foreign";   // 국적 → 프록시 국가 매칭
  proxy?: ProxyConfig;              // 명시 프록시(있으면 우선). 없으면 nationality로 조회
  headful?: boolean;               // 🚪 창 보기
  watchSeconds?: number; // 롱폼 목표 시청 초(기본 60)
  onLog: (msg: string) => void;
  stopSignal: () => boolean;
}): Promise<{ status: "success" | "fail"; watchedSeconds: number; error?: string }> {
  const { videoUrl, videoType, gateway, nationality = "kr", onLog, stopSignal } = params;
  const referer = GATEWAY_REFERRER[gateway] || "";

  // ── [1/8] 프록시 결정 — 국적 매칭 + DataImpulse sticky(방문당 IP 고정) ──
  onLog(`[1/8] 🌐 프록시 준비 — ${nationality === "kr" ? "🇰🇷 한국" : "🌍 해외"} IP 조회 중…`);
  let proxy: PxConfig | null = params.proxy || (await getProxyForNationality(nationality));
  proxy = stickifyDataImpulse(proxy);
  if (proxy) onLog(`[2/8] 🔒 프록시 사용 — 내 실제 IP를 가리고 ${maskProxy(proxy)} 로 접속(방문 동안 IP 고정)`);
  else onLog(`[2/8] ⚠️ 프록시 미배정 — 내 실제 IP로 접속(차단 위험). gs_proxies에 등록하면 안전해져요`);

  const { browser, context } = await newContext({ gateway, proxy: proxy || undefined, headful: params.headful });
  const page = await context.newPage();
  let watched = 0;
  try {
    const gwLabel = gateway === "instagram" ? "인스타" : gateway === "facebook" ? "페북" : "직접";
    onLog(`[3/8] 🧭 게이트웨이 = ${gwLabel} referrer(${referer || "없음"}) + 인앱 UA — "소셜에서 넘어온 유입"으로 위장`);
    onLog(`[4/8] ▶️ 영상 진입 중… [${videoType === "shorts" ? "쇼츠" : "롱폼"}]`);
    // 게이트웨이 referrer 달고 영상 진입 = "소셜에서 넘어온 유입"으로 인식
    //  ⚠️ 프록시(DataImpulse) 경유 + 유튜브는 무거운 SPA라 domcontentloaded/30s로는 자주 타임아웃.
    //     waitUntil:"commit"(네비게이션 확정=서버 첫 응답)으로 빠르게 통과 + timeout 넉넉히 + 1회 재시도.
    //     진입 후 어차피 dismissConsent/ensurePlaying이 필요한 요소를 기다리므로 commit로 충분.
    const gotoOnce = () => page.goto(videoUrl, { waitUntil: "commit", timeout: 60000, referer: referer || undefined });
    try {
      await gotoOnce();
    } catch (e: any) {
      onLog(`  ⚠️ 진입 지연(프록시 응답 느림) — 재시도… (${String(e?.message || e).split("\n")[0]})`);
      await gotoOnce();   // 재시도도 실패하면 바깥 catch에서 fail 처리
    }
    // 첫 응답 후 DOM 안정화 잠깐 대기(실패해도 진행 — 이후 요소 대기가 받쳐줌)
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    onLog(`[5/8] 📄 페이지 로드됨 — 동의/광고 팝업 정리 중…`);
    await page.waitForTimeout(humanDelayMs(1.5, 3));
    await dismissConsent(page);
    await trySkipAd(page);
    const dur = await ensurePlaying(page);
    onLog(`[6/8] ▶️ 재생 시작 (영상 길이 ${dur ? Math.round(dur) + "s" : "불명"}) — 시청 시작`);

    if (videoType === "shorts") {
      // 쇼츠: 짧으니 완주 + 루프(1~2회) = 완주율/재시청 신호
      const loops = 1 + Math.round(Math.random());
      onLog(`[7/8] ⏱️ 쇼츠 완주 시딩 — ${loops}회 완주(완주율 신호) 시작`);
      for (let i = 0; i < loops; i++) {
        if (stopSignal()) { onLog(`  ⏹ 중단 신호 감지 — 이번 방문 정리`); break; }
        const d = (await ensurePlaying(page)) || 20;
        const watchMs = Math.min(d, 60) * 1000 + humanDelayMs(0.5, 2);
        await sleep(watchMs);
        watched += Math.round(watchMs / 1000);
        onLog(`  ⏱️ 완주 ${i + 1}/${loops} (누적 ${watched}s)`);
      }
    } else {
      // 롱폼: 목표 시청초까지 나눠서 체류(첫 구간 이탈 방지). watch time이 핵심
      const target = params.watchSeconds ?? 60;
      onLog(`[7/8] ⏱️ 롱폼 watch time 시딩 — 목표 ${target}s 체류(첫 구간 이탈 방지) 시작`);
      let elapsed = 0;
      while (elapsed < target) {
        if (stopSignal()) { onLog(`  ⏹ 중단 신호 감지 — 이번 방문 정리`); break; }
        const chunk = Math.min(target - elapsed, 10 + Math.random() * 15);
        await sleep(chunk * 1000);
        elapsed += chunk;
        watched = Math.round(elapsed);
        // 가끔 자연스러운 미세 스크롤(사람다움)
        if (Math.random() < 0.3) await page.mouse.wheel(0, 80 + Math.random() * 120).catch(() => {});
        onLog(`  ⏱️ 시청 ${watched}/${target}s (${Math.round((watched / target) * 100)}%)`);
      }
    }

    onLog(`[8/8] ✅ 조회 시딩 완료 — watch ${watched}s (velocity 1건 확보)`);
    await browser.close().catch(() => {});
    return { status: "success", watchedSeconds: watched };
  } catch (e: any) {
    await browser.close().catch(() => {});
    onLog(`❌ 조회 실패: ${e.message}`);
    return { status: "fail", watchedSeconds: watched, error: e.message };
  }
}
