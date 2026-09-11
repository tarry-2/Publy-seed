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
  // 🔴🔴 프록시로 유튜브 진입 시 page.goto 타임아웃의 진짜 원인 = HTTP/2 (실측 확정).
  //   DataImpulse CONNECT 터널에서 Chromium이 HTTP/2로 구글/유튜브에 붙으면 응답이 안 와 hang.
  //   HTTP/1.1로 강제하면 프록시로도 1~2초에 진입 성공(curl이 됐던 이유도 HTTP/1.1). QUIC/스킴/세미콜론 다 무관이었음.
  "--disable-http2",
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

// ═══════════════════════════════════════════════════════════════
//  채널 영상목록 불러오기 (A+B 혼합) — 쇼츠/롱폼 분류 + 메타 수집
//  ★ 분류 기준(테리 확정): 유튜브 공식 분류(어느 탭)를 1차로 따르고,
//    재생시간 179초(2:59) 상한으로 보정한다(2024-10-15 쇼츠 3분 규칙).
//    - 쇼츠 = /shorts 탭 & duration ≤ 179s
//    - 롱폼 = /videos 탭  (또는 쇼츠탭이라도 duration > 179s면 강등)
//  ★ 수익화(YPP) 브리핑 재활용 위해 구독자수 + 영상별 조회수도 같이 긁는다.
// ═══════════════════════════════════════════════════════════════
export const SHORTS_MAX_SEC = 179; // 2:59 — 이 이하만 쇼츠(그 초과는 롱폼)

export interface ChannelVideo {
  videoId: string;
  url: string;
  title: string;
  thumb: string;                 // videoId로 생성(항상 확보)
  type: "shorts" | "longform";
  durationSec?: number;          // 재생시간(초) — 분류 보정 + 표시
  views?: number;                // 조회수(근사) — 수익화 브리핑용
  publishedAt?: number;          // epoch ms(RSS 정확). 골든아워 30분 판정
  publishedText?: string;        // 스크래핑 상대시간("3시간 전")
}

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 채널 URL 정규화 → 탭 없는 베이스(끝에 /videos·/shorts 붙일 수 있게)
function normalizeChannelBase(input: string): string {
  let s = (input || "").trim();
  if (!/^https?:\/\//.test(s)) {
    if (s.startsWith("@")) s = "https://www.youtube.com/" + s;
    else s = "https://www.youtube.com/" + s.replace(/^\//, "");
  }
  s = s.replace(/\/(videos|shorts|streams|featured|community|playlists|about|home)\/?(\?.*)?$/i, "");
  s = s.replace(/\?.*$/, "").replace(/\/$/, "");
  return s;
}

// "1:23" / "12:34" / "1:02:03" → 초
function parseDuration(text: string): number | undefined {
  const m = (text || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return undefined;
  return m[3] ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
}

// "조회수 1.2만회" / "1.2M views" / "1,234회" → 숫자(근사)
function parseViews(text: string): number | undefined {
  const t = (text || "").replace(/조회수|views?|,/gi, "").trim();
  const m = t.match(/([\d.]+)\s*(억|만|천|[KMB])?/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]); if (isNaN(n)) return undefined;
  const unit = (m[2] || "").toUpperCase();
  const mult: Record<string, number> = { "억": 1e8, "만": 1e4, "천": 1e3, K: 1e3, M: 1e6, B: 1e9 };
  return Math.round(n * (mult[unit] || 1));
}

// 채널 탭 1개 스크래핑 — DOM의 a[href]에서 videoId 수집(셀렉터 변화에 강함)
async function scrapeChannelTab(
  page: Page, url: string, tabType: "shorts" | "longform", onLog: (m: string) => void
): Promise<Array<{ videoId: string; title: string; durationText: string; viewsText: string; metaText: string }>> {
  onLog(`  ↳ ${tabType === "shorts" ? "쇼츠" : "동영상"} 탭 스크래핑… (${url})`);
  await page.goto(url, { waitUntil: "commit", timeout: 60000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
  await dismissConsent(page);
  await page.waitForTimeout(1200);
  // 여러 번 스크롤해 더 로드(오래 걸려도 최대한 많이)
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 4000).catch(() => {});
    await page.waitForTimeout(800);
  }
  return await page.evaluate(() => {
    const DUR_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;             // "mm:ss" / "h:mm:ss"
    const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim();
    const out: Array<{ videoId: string; title: string; durationText: string; viewsText: string; metaText: string }> = [];
    const seen = new Set<string>();
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      const w = href.match(/\/watch\?v=([\w-]{11})/);
      const s = href.match(/\/shorts\/([\w-]{11})/);
      const id = w ? w[1] : s ? s[1] : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const card = (a.closest(
        "ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytm-shorts-lockup-view-model, ytd-reel-item-renderer, ytd-rich-grid-media, yt-lockup-view-model"
      ) || a.parentElement) as Element | null;

      // 제목 — 제목 전용 요소를 우선(썸네일 링크는 제목 텍스트가 없어 duration을 잘못 집던 문제 수정)
      let title = "";
      if (card) {
        const cand = card.querySelector(
          "#video-title, #video-title-link, a#video-title-link, h3 a, h3, .yt-lockup-metadata-view-model-wiz__title, .shortsLockupViewModelHostMetadataTitle"
        );
        title = clean(cand?.getAttribute("title") || cand?.textContent || "");
      }
      // 폴백: 링크 자체의 title/aria-label(쇼츠는 aria-label에 "제목 · 조회수…" → 메타 앞부분만)
      if (!title || DUR_RE.test(title)) {
        let alt = a.getAttribute("title") || a.getAttribute("aria-label") || "";
        alt = alt.split(/\s*[,·]\s*(?=조회수|[\d.,]+\s*(?:억|만|천|[KMB])?\s*회|[\d.,]+\s*[KMB]?\s*views)/i)[0];
        title = clean(alt);
      }
      if (DUR_RE.test(title)) title = "";   // 그래도 duration이면 제목 없음 처리

      // 재생시간(mm:ss 패턴 텍스트) — 카드 안에서 탐색
      let durationText = "";
      if (card) {
        for (const el of Array.from(card.querySelectorAll("span, div"))) {
          const tx = (el.textContent || "").trim();
          if (DUR_RE.test(tx)) { durationText = tx; break; }
        }
      }
      // 메타(조회수·N일 전)
      const metaEl = card?.querySelector("#metadata-line, .inline-metadata-item, .yt-content-metadata-view-model-wiz__metadata-row");
      const metaText = clean(metaEl?.textContent || card?.textContent?.slice(0, 160) || "");
      const viewsText = (metaText.match(/[\d.,]+\s*(억|만|천|[KMB])?\s*(회|views?)/i) || [""])[0];
      out.push({ videoId: id, title, durationText, viewsText, metaText });
    }
    return out;
  });
}

// 채널 구독자수 긁기(공개) — "구독자 1.2만명" / "1.2M subscribers"
async function scrapeSubscribers(page: Page): Promise<number | undefined> {
  const txt = await page.evaluate(() => {
    const el = document.querySelector(
      "#subscriber-count, yt-formatted-string#subscriber-count, .yt-content-metadata-view-model-wiz__metadata-row"
    ) as HTMLElement | null;
    const body = document.body?.innerText || "";
    return (el?.textContent || "") + " || " + body;
  }).catch(() => "");
  const m = (txt || "").match(/구독자\s*([\d.,]+\s*(?:억|만|천)?)\s*명|([\d.,]+\s*[KMB]?)\s*subscribers?/i);
  if (!m) return undefined;
  return parseViews(m[1] || m[2] || "");
}

// RSS로 정확한 업로드 시각 보강(최근 15개) — node fetch, 프록시 불필요
async function fetchChannelRss(channelId: string): Promise<Array<{ videoId: string; publishedAt: number }>> {
  try {
    const resp = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const out: Array<{ videoId: string; publishedAt: number }> = [];
    for (const e of xml.split("<entry>").slice(1)) {
      const id = (e.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/) || [])[1];
      const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
      if (id && pub) { const t = Date.parse(pub); if (!isNaN(t)) out.push({ videoId: id, publishedAt: t }); }
    }
    return out;
  } catch { return []; }
}

export async function fetchChannelVideos(params: {
  channelUrl: string;
  nationality?: "kr" | "foreign";
  proxy?: ProxyConfig;
  headful?: boolean;
  onLog?: (m: string) => void;
}): Promise<{ channelId?: string; subscribers?: number; videos: ChannelVideo[] }> {
  const onLog = params.onLog || (() => {});
  const base = normalizeChannelBase(params.channelUrl);
  onLog(`🌐 채널 불러오기 시작 — ${base}`);

  // 프록시(seedView와 동일 정책: 국적 매칭 + sticky)
  let proxy: PxConfig | null = params.proxy || (await getProxyForNationality(params.nationality || "kr"));
  proxy = stickifyDataImpulse(proxy);
  onLog(proxy ? `🔒 프록시 ${maskProxy(proxy)}` : `⚠️ 프록시 미배정 — 내 IP로 목록 조회`);

  // 목록 스크래핑용 데스크탑 컨텍스트(LAUNCH_ARGS 재사용 = http2 off 포함)
  const browser = await chromium.launch({
    headless: params.headful !== true,
    args: LAUNCH_ARGS,
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  });
  const context = await browser.newContext({
    userAgent: DESKTOP_UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
  const page = await context.newPage();
  const map = new Map<string, ChannelVideo>();

  try {
    // 쇼츠 탭 먼저(중복 시 쇼츠 우선) → 동영상 탭
    const shortsRaw = await scrapeChannelTab(page, `${base}/shorts`, "shorts", onLog);
    const subscribers = await scrapeSubscribers(page).catch(() => undefined);
    const videosRaw = await scrapeChannelTab(page, `${base}/videos`, "longform", onLog);

    for (const [tabType, raw] of [["shorts", shortsRaw], ["longform", videosRaw]] as const) {
      for (const it of raw) {
        if (map.has(it.videoId)) continue;
        const durationSec = parseDuration(it.durationText);
        // 분류: 탭 기준 + 2:59 상한 보정(쇼츠탭이라도 179s 초과면 롱폼)
        let type: "shorts" | "longform" = tabType;
        if (type === "shorts" && durationSec != null && durationSec > SHORTS_MAX_SEC) type = "longform";
        map.set(it.videoId, {
          videoId: it.videoId,
          url: type === "shorts" ? `https://www.youtube.com/shorts/${it.videoId}` : `https://www.youtube.com/watch?v=${it.videoId}`,
          title: it.title || "(제목 없음)",
          thumb: `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`,
          type,
          durationSec,
          views: parseViews(it.viewsText || it.metaText),
          publishedText: (it.metaText.match(/(방금|[\d]+\s*(초|분|시간|일|주|개월|년)\s*전|[\d]+\s*(second|minute|hour|day|week|month|year)s?\s*ago)/i) || [])[0] || undefined,
        });
      }
    }

    // channelId 추출 → RSS로 최근 15개 정확 시각 보강(골든아워 30분 판정)
    let channelId = (base.match(/\/channel\/(UC[\w-]+)/) || [])[1];
    if (!channelId) {
      const html = await page.content().catch(() => "");
      channelId = (html.match(/"channelId":"(UC[\w-]+)"/) || [])[1] || (html.match(/channel\/(UC[\w-]+)/) || [])[1];
    }
    if (channelId) {
      onLog(`  ↳ RSS로 업로드 시각 보강(최근 15개)…`);
      for (const r of await fetchChannelRss(channelId)) {
        const v = map.get(r.videoId); if (v) v.publishedAt = r.publishedAt;
      }
    }

    const videos = [...map.values()];
    const nShorts = videos.filter((v) => v.type === "shorts").length;
    onLog(`✅ 불러오기 완료 — 총 ${videos.length}개 (쇼츠 ${nShorts} · 롱폼 ${videos.length - nShorts})${subscribers != null ? ` · 구독자 ${subscribers.toLocaleString()}` : ""}`);
    await browser.close().catch(() => {});
    return { channelId, subscribers, videos };
  } catch (e: any) {
    await browser.close().catch(() => {});
    onLog(`❌ 채널 불러오기 실패: ${e.message}`);
    throw e;
  }
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
