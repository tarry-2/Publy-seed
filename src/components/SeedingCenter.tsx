import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { BotEventStream, botFetch } from "../lib/botApi";
import MascotBot from "./MascotBot";
import MonetizeCoach from "./MonetizeCoach";
import { GS_PLAN_LIMITS, GS_PLAN_LABEL, GsPlan } from "../lib/supabase";

/* ───────────────────────────────────────────────────────────
   골든시드 시딩 콘솔 (SeedingCenter)
   - 유튜브 / 인스타는 각각 완전히 독립된 패널(SeedingPanel).
     URL·콘텐츠타입·국적·게이트웨이·액션·물량·AI키·KPI·로그·실행상태를
     플랫폼마다 따로 가진다(한쪽에 넣은 게 다른쪽에 안 붙음).
   - 두 패널은 항상 마운트하고 display로만 토글 → 실행 중 탭 옮겨도 안 꺼짐(트래픽 원칙 A).
   - 라이트/다크 둘 다. 봇: youtube-bot(3366) 조회 시딩 SSE(BotEventStream 토큰).
   ⚠️ 조회(view)만 실동작(STEP1). 좋아요/댓글/공유 등은 UI 완성 + 계정 붙는대로 연결.
─────────────────────────────────────────────────────────── */

const YT_BOT = "http://localhost:3366";
const INSTA_BOT = "http://localhost:3367";   // 골든시드 인스타 봇(유튜브 3366과 분리 → 동시 실행)
const F_DISPLAY = "'Sora', ui-sans-serif, system-ui, sans-serif";
const F_BODY = "'Pretendard', -apple-system, system-ui, sans-serif";
const F_MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace";

type Platform = "youtube" | "instagram";
type Nationality = "kr" | "foreign";
type Gateway = "instagram" | "facebook" | "direct";
type LogLine = { t: number; kind: "log" | "ok" | "err" | "sys"; msg: string };
// 채널 불러오기 영상(봇 fetchChannelVideos 반환과 동일)
type ChannelVideo = {
  videoId: string; url: string; title: string; thumb: string;
  type: "shorts" | "longform"; durationSec?: number; views?: number;
  publishedAt?: number; publishedText?: string;
};
const GOLDEN_MS = 30 * 60 * 1000; // 골든아워 = 업로드 30분 이내
const isGolden = (v: ChannelVideo) => v.publishedAt != null && Date.now() - v.publishedAt <= GOLDEN_MS;
const fmtDur = (s?: number) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const fmtAgo = (v: ChannelVideo) => {
  if (v.publishedAt == null) return v.publishedText || "";
  const m = Math.floor((Date.now() - v.publishedAt) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}일 전`;
  return `${Math.floor(d / 30)}개월 전`;
};

// 플랫폼별 콘텐츠 타입
const CONTENT: Record<Platform, [string, string][]> = {
  youtube: [["longform", "롱폼"], ["shorts", "쇼츠"]],
  instagram: [["post", "게시물"], ["reels", "릴스"], ["story", "스토리"]],
};

type ActionDef = { id: string; label: string; icon: string; def: number; ai?: boolean; warn?: string; desc?: string };
// 플랫폼별 액션(모든 기능) — 골든아워 실전 물량 기본값
const ACTIONS: Record<Platform, ActionDef[]> = {
  youtube: [
    { id: "view", label: "조회수", icon: "👁", def: 300, desc: "첫 프레임 재생 — velocity 핵심" },
    { id: "watch", label: "시청수", icon: "⏱", def: 100, desc: "끝까지 시청 — engaged·수익 신호" },
    { id: "like", label: "좋아요", icon: "👍", def: 10 },
    { id: "comment", label: "댓글", icon: "💬", def: 10, ai: true, desc: "AI가 영상 보고 작성" },
    { id: "subscribe", label: "구독", icon: "🔔", def: 5 },
    { id: "share", label: "공유", icon: "📤", def: 8 },
  ],
  instagram: [
    { id: "view", label: "조회수", icon: "👁", def: 300 },
    { id: "like", label: "좋아요", icon: "❤️", def: 10 },
    { id: "comment", label: "댓글", icon: "💬", def: 10, ai: true, desc: "AI가 게시물 보고 작성" },
    { id: "follow", label: "팔로우", icon: "➕", def: 5 },
    { id: "share", label: "공유", icon: "📤", def: 12, desc: "sends — 비팔로워 도달 최강" },
    { id: "repost", label: "리포스트", icon: "🔁", def: 2, warn: "30일 10개↑ = 추천 제외 위험" },
    { id: "save", label: "저장", icon: "🔖", def: 8 },
  ],
};

function palette(dark: boolean) {
  return dark
    ? {
        bg: "radial-gradient(1200px 600px at 15% -10%, #1c1608 0%, transparent 55%), radial-gradient(900px 500px at 110% 10%, #160f1e 0%, transparent 50%), #08070b",
        panel: "#131019", panel2: "#1b1725", line: "#2a2436",
        ink: "#f4efe4", sub: "#9a9284",
        gold: "#f5c451", goldDim: "#c9a03f", goldGlow: "rgba(245,196,81,.16)",
        logBg: "#0b0910", logInk: "#d8cdb4", chip: "rgba(255,255,255,.03)",
        yt: "#ff3b3b", igGrad: "linear-gradient(90deg,#f09433,#dc2743,#bc1888)",
      }
    : {
        bg: "radial-gradient(1200px 600px at 15% -10%, #fdf1cf 0%, transparent 55%), radial-gradient(900px 500px at 110% 10%, #fbe9d4 0%, transparent 50%), #faf5ea",
        panel: "#fffdf7", panel2: "#f6efdf", line: "#e8dcc0",
        ink: "#2a2010", sub: "#8a7a52",
        gold: "#b8860b", goldDim: "#9a6f14", goldGlow: "rgba(184,134,11,.12)",  // 라이트=딥골드(가독성)
        logBg: "#1a1408", logInk: "#e8dcc0", chip: "rgba(0,0,0,.03)",           // 로그는 항상 다크 터미널
        yt: "#e11d1d", igGrad: "linear-gradient(90deg,#f09433,#dc2743,#bc1888)",
      };
}

function initActions(p: Platform): Record<string, { on: boolean; qty: number }> {
  const o: Record<string, { on: boolean; qty: number }> = {};
  ACTIONS[p].forEach((a) => { o[a.id] = { on: a.id === "view", qty: a.def }; });
  return o;
}

// ═══════════════════════════════════════════════════════════
// 상위 셸 — 헤더 + 플랫폼 탭 + 두 독립 패널(display 토글로 항상 마운트)
// ═══════════════════════════════════════════════════════════
export default function SeedingCenter({ showToast, theme = "dark", approvedTools, allowedByTool, planByTool }: {
  showToast?: (m: string, t?: any) => void;
  theme?: "light" | "dark";
  approvedTools?: string[];             // 승인된 플랫폼(없으면 전체 허용 = 관리자/미게이트 모드)
  allowedByTool?: Record<string, string[]>;  // 플랫폼별 승인된 액션 id 배열
  planByTool?: Record<string, string>;       // 플랫폼별 승인 등급(물량 상한용)
}) {
  const dark = theme === "dark";
  const T = palette(dark);
  // 승인된 플랫폼만 탭에 노출(approvedTools 없으면 전체 = 예전 동작 유지)
  const platforms: Platform[] = (approvedTools && approvedTools.length)
    ? (["youtube", "instagram"] as Platform[]).filter(p => approvedTools.includes(p))
    : (["youtube", "instagram"] as Platform[]);
  const [platform, setPlatform] = useState<Platform>(platforms[0] || "youtube");

  return (
    <div style={{ minHeight: "100%", background: T.bg, color: T.ink, fontFamily: F_BODY, padding: "18px 20px 24px" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <MascotBot size={44} />
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 19, letterSpacing: "-.02em" }}>
            GoldenSeed <span style={{ color: T.gold }}>시딩 콘솔</span>
          </div>
          <div style={{ fontSize: 11.5, color: T.sub, marginTop: 1 }}>골든아워 초기시딩 — 임계선 밑에서 자연스럽게</div>
        </div>
      </div>

      {/* 플랫폼 탭 — 승인된 플랫폼만. 각각 독립 패널 전환(상태는 서로 안 섞임) */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {platforms.map((p) => {
          const on = platform === p, isYt = p === "youtube";
          return (
            <button key={p} onClick={() => setPlatform(p)} style={{
              flex: 1, padding: "11px 14px", borderRadius: 12, cursor: "pointer",
              border: `1px solid ${on ? (isYt ? T.yt : T.gold) : T.line}`,
              background: on ? (isYt ? "rgba(255,59,59,.10)" : T.goldGlow) : T.panel,
              color: on ? T.ink : T.sub, fontWeight: 700, fontFamily: F_DISPLAY, fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all .18s",
            }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: isYt ? T.yt : T.igGrad }} />
              {isYt ? "유튜브" : "인스타"}
            </button>
          );
        })}
      </div>

      {/* 승인된 패널만 항상 마운트 → 실행 중 탭 옮겨도 언마운트 안 됨(트래픽 원칙 A) */}
      {platforms.includes("youtube") && (
        <div style={{ display: platform === "youtube" ? "block" : "none" }}>
          <SeedingPanel platform="youtube" showToast={showToast} T={T} dark={dark} allowedActions={allowedByTool?.youtube} plan={planByTool?.youtube} />
        </div>
      )}
      {platforms.includes("instagram") && (
        <div style={{ display: platform === "instagram" ? "block" : "none" }}>
          <SeedingPanel platform="instagram" showToast={showToast} T={T} dark={dark} allowedActions={allowedByTool?.instagram} plan={planByTool?.instagram} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 플랫폼별 독립 패널 — 자기 URL·액션·로그·KPI·실행상태를 전부 따로 가진다
// ═══════════════════════════════════════════════════════════
function SeedingPanel({ platform, showToast, T, dark, allowedActions, plan }: { platform: Platform; showToast?: (m: string, t?: any) => void; T: any; dark: boolean; allowedActions?: string[]; plan?: string }) {
  const isYt = platform === "youtube";
  const BOT = isYt ? YT_BOT : INSTA_BOT;   // 플랫폼별 봇(동시 실행 = 포트 분리)
  const accent = isYt ? T.yt : T.gold;
  // 승인된 액션만 노출(allowedActions 없으면=미게이트/관리자 전체 허용)
  const gated = Array.isArray(allowedActions);
  const defs = gated ? ACTIONS[platform].filter(a => allowedActions!.includes(a.id)) : ACTIONS[platform];
  // 등급 물량 상한 — plan 있으면 그 등급 한도, 없으면(관리자/미게이트) 무제한(0)
  const gsPlan = (plan as GsPlan) || "unlimited";
  const limitOf = (actionId: string): number => {
    const t = GS_PLAN_LIMITS[platform]?.[actionId];
    return t ? (t[gsPlan] ?? 0) : 0;   // 0 = 무제한
  };

  const [videoUrl, setVideoUrl] = useState("");
  // 💾 저장된 URL 목록(플랫폼별, localStorage) — 다시 들어와도 유지, 클릭하면 바로 입력
  const SAVED_KEY = `gs_saved_urls_${platform}`;
  const [savedUrls, setSavedUrls] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); } catch { return []; }
  });
  const persistUrls = (list: string[]) => {
    setSavedUrls(list);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch {}
  };
  const saveCurrentUrl = () => {
    const u = videoUrl.trim();
    if (!u) { showToast?.("먼저 URL을 입력하세요", "error"); return; }
    if (savedUrls.includes(u)) { showToast?.("이미 저장된 링크예요", "info"); return; }
    persistUrls([u, ...savedUrls].slice(0, 20));   // 최근 20개까지
    showToast?.("링크를 저장했어요", "success");
  };
  const removeSavedUrl = (u: string) => persistUrls(savedUrls.filter(x => x !== u));
  const [contentType, setContentType] = useState<string>(isYt ? "shorts" : CONTENT[platform][0][0]);
  // 📺 채널 불러오기(유튜브) — 채널 주소 → 영상목록(쇼츠/롱폼 분류) → 골라서 전체 시딩
  //  ★ 크래시/재시작에도 안 날아가게 localStorage 영속(트래픽 원칙 B). 불러온 "그 시점 스냅샷".
  const CHAN_KEY = `gs_channel_${platform}`;
  const [channelUrl, setChannelUrl] = useState(() => { try { return localStorage.getItem(`${CHAN_KEY}_url`) || ""; } catch { return ""; } });
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelVideos, setChannelVideos] = useState<ChannelVideo[]>(() => { try { return JSON.parse(localStorage.getItem(`${CHAN_KEY}_vids`) || "[]"); } catch { return []; } });
  const [channelSubs, setChannelSubs] = useState<number | undefined>(() => { try { const s = localStorage.getItem(`${CHAN_KEY}_subs`); return s ? Number(s) : undefined; } catch { return undefined; } });
  const [channelLoadedAt, setChannelLoadedAt] = useState<number | undefined>(() => { try { const s = localStorage.getItem(`${CHAN_KEY}_at`); return s ? Number(s) : undefined; } catch { return undefined; } });
  const [sortOrder, setSortOrder] = useState<"recent" | "old">("recent");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const chanEsRef = useRef<BotEventStream | null>(null);
  // 입력한 채널 주소는 즉시 영속(다시 안 쳐도 됨)
  useEffect(() => { try { localStorage.setItem(`${CHAN_KEY}_url`, channelUrl); } catch {} }, [channelUrl, CHAN_KEY]);
  // 💾 저장한 내 계정(채널) 목록 — 삭제 전엔 안 사라짐(유튜브·인스타 공용, 플랫폼별)
  const CHAN_SAVED = `gs_saved_channels_${platform}`;
  const [savedChannels, setSavedChannels] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(CHAN_SAVED) || "[]"); } catch { return []; } });
  const persistChannels = (list: string[]) => { setSavedChannels(list); try { localStorage.setItem(CHAN_SAVED, JSON.stringify(list)); } catch {} };
  const saveChannel = () => {
    const u = channelUrl.trim();
    if (!u) { showToast?.("채널(계정) 주소를 입력하세요", "error"); return; }
    if (savedChannels.includes(u)) { showToast?.("이미 저장된 계정이에요", "info"); return; }
    persistChannels([u, ...savedChannels].slice(0, 30));
    showToast?.("계정을 저장했어요 (삭제 전엔 유지돼요)", "success");
  };
  const removeChannel = (u: string) => persistChannels(savedChannels.filter((x) => x !== u));
  const [nationality, setNationality] = useState<Nationality>("kr");
  const [gateway, setGateway] = useState<Gateway>(isYt ? "instagram" : "direct");
  const [watchSeconds, setWatchSeconds] = useState(60);
  const [actions, setActions] = useState(() => initActions(platform));
  const [aiKey, setAiKey] = useState("");
  const [visible, setVisible] = useState(false);   // 🚪 창 보기 — 봇 브라우저 창 표시(매번 꺼짐, 안전)
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([
    isYt
      ? { t: Date.now(), kind: "sys", msg: "골든시드 유튜브 시딩 콘솔 준비됨. 골든아워(첫 30분)에 시딩하세요." }
      : { t: Date.now(), kind: "sys", msg: "인스타 시딩은 준비 중이에요(STEP2). 계정 로그인 시스템이 붙은 뒤 열립니다." },
  ]);
  const [stats, setStats] = useState({ views: 0, success: 0, fail: 0 });
  const [logZoom, setLogZoom] = useState(false);   // 🔍 로그 크게 보기(앱 내 모달, 트래픽 계승)
  // ⏱️ 골든아워 스케줄러 상태
  const [ghTarget, setGhTarget] = useState(0);      // 현재 영상 목표 조회 물량
  const [ghDone, setGhDone] = useState(0);          // 현재 영상 실행된 조회 수
  const [ghElapsed, setGhElapsed] = useState(0);    // 경과 초
  const [queueIdx, setQueueIdx] = useState(0);      // 큐: 현재 영상 순번(1-based)
  const [queueTotal, setQueueTotal] = useState(0);  // 큐: 전체 영상 수
  const GH_WINDOW = 30 * 60;                         // 골든아워 = 30분(초)
  const esRef = useRef<BotEventStream | null>(null);
  const jobRef = useRef<string>("");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const schedRef = useRef<{ stop: boolean; timer: any; started: number }>({ stop: false, timer: null, started: 0 });

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => () => { esRef.current?.close(); chanEsRef.current?.close(); }, []);

  // 골든아워 실행 중 경과초 1초마다 갱신(진행바·남은시간)
  useEffect(() => {
    if (!running) return;
    const iv = window.setInterval(() => {
      if (schedRef.current.started) setGhElapsed(Math.floor((Date.now() - schedRef.current.started) / 1000));
    }, 1000);
    return () => window.clearInterval(iv);
  }, [running]);

  // 등급(plan) 바뀌면 각 액션 물량을 그 등급 상한으로 clamp(기본값이 상한보다 크면 낮춤)
  useEffect(() => {
    setActions((a) => {
      const next = { ...a }; let changed = false;
      Object.keys(next).forEach((id) => {
        const lim = limitOf(id);
        if (lim > 0 && next[id].qty > lim) { next[id] = { ...next[id], qty: lim }; changed = true; }
      });
      return changed ? next : a;
    });
  }, [plan]);

  const pushLog = (kind: LogLine["kind"], msg: string) => setLogs((l) => [...l.slice(-400), { t: Date.now(), kind, msg }]);
  const commentOn = actions["comment"]?.on;

  const toggleAction = (id: string) => setActions((a) => ({ ...a, [id]: { ...a[id], on: !a[id].on } }));
  const setQty = (id: string, v: number) => setActions((a) => {
    const lim = limitOf(id);                       // 0=무제한
    const capped = lim > 0 ? Math.min(Math.max(0, v), lim) : Math.max(0, v);
    if (lim > 0 && v > lim) showToast?.(`${gsPlan !== "unlimited" ? GS_PLAN_LABEL[gsPlan] + " 등급 " : ""}상한 ${lim}회까지예요`, "info");
    return { ...a, [id]: { ...a[id], qty: capped } };
  });

  // ★트래픽 계승(2026-09-07 테리): '이어하기' 개념 제거 — 시작은 항상 새 설정으로 처음부터.
  //   (이어하기가 최초 설정을 물고 가서 수정한 설정이 무시되던 버그 방지.)
  function start() {
    if (running) return;
    // 🎯 대상 영상 큐: 채널에서 선택한 게 있으면 그걸 순차, 없으면 단일 URL(기존 동작)
    const chosen: { url: string; type: "shorts" | "longform" }[] =
      (isYt && selectedIds.size > 0)
        ? sortedVideos.filter((v) => selectedIds.has(v.videoId)).map((v) => ({ url: v.url, type: v.type }))
        : videoUrl.trim()
          ? [{ url: videoUrl.trim(), type: (contentType === "longform" ? "longform" : "shorts") }]
          : [];
    if (!chosen.length) { showToast?.(isYt ? "영상을 선택하거나 URL을 입력하세요" : "URL을 입력하세요", "error"); return; }
    const picked = defs.filter((d) => actions[d.id]?.on && actions[d.id].qty > 0);
    if (!picked.length) { showToast?.("실행할 액션을 하나 이상 켜세요", "error"); return; }
    if (commentOn && !aiKey.trim()) { showToast?.("댓글은 AI 키가 필요해요", "error"); return; }

    setStats({ views: 0, success: 0, fail: 0 });
    const jobId = Date.now().toString();
    jobRef.current = jobId;
    setRunning(true);

    // ── 디테일 로그(1~N) — 트래픽처럼 단계별로 상세하게 ──
    pushLog("sys", `▶️ 시딩 시작 — ${isYt ? "유튜브" : "인스타"} · 대상 ${chosen.length}개 영상`);
    if (chosen.length === 1) pushLog("log", `🌐 대상 URL: ${chosen[0].url}`);
    else pushLog("log", `🌐 선택한 ${chosen.length}개 영상을 순차 시딩(영상마다 골든아워 곡선)`);
    pushLog("log", `🧭 게이트웨이: ${gateway === "instagram" ? "인스타 referrer" : gateway === "facebook" ? "페북 referrer" : "직접"} · 국적: ${nationality === "kr" ? "🇰🇷 한국인" : "🌍 외국인"} 계정풀`);
    pushLog("log", `🎯 선택 액션 ${picked.length}종: ${picked.map((d) => `${d.icon}${d.label}×${actions[d.id].qty}`).join(" · ")}`);
    if (visible) pushLog("log", "🚪 창 보기 ON — 봇 브라우저 창을 띄웁니다");
    if (!isYt) pushLog("sys", "ℹ️ 인스타는 비로그인 시 로그인 벽이 있어 조회 카운트가 불확실할 수 있어요(진입·체류는 수행). 계정 연결(STEP2) 후 확실해집니다.");

    // 조회(view)만 실제 봇 연동(STEP1). 나머지는 계정 붙는대로 순차 연결.
    if (actions["view"]?.on && actions["view"].qty > 0) {
      const total = actions["view"].qty;
      pushLog("sys", `⏱️ 골든아워 스케줄러 시작 — 영상당 조회 ${total}회를 30분 자연 성장곡선(초반 집중→테이퍼링)으로 시딩${chosen.length > 1 ? ` · 총 ${chosen.length}개 순차` : ""}`);
      runQueue(chosen, total, jobId);
    } else {
      pushLog("sys", "ℹ️ 조회 외 액션은 계정 워밍업(STEP2+) 후 연결됩니다 — 물량 설정은 저장돼요.");
      setRunning(false);
    }
    // 조회 외 선택 액션 안내(구현 예정)
    picked.filter((d) => d.id !== "view").forEach((d) => pushLog("log", `⏳ ${d.icon} ${d.label} ×${actions[d.id].qty} — 준비 중(계정 연결 후 실행)`));
  }

  // 🎬 영상 큐 — 선택한 영상들을 하나씩(순차) 골든아워 곡선으로 시딩(안전·티 덜 남)
  function runQueue(queue: { url: string; type: "shorts" | "longform" }[], perVideoTotal: number, jobId: string) {
    setQueueTotal(queue.length);
    let vi = 0;
    const runVideo = () => {
      if (schedRef.current.stop) { setRunning(false); return; }
      if (vi >= queue.length) {
        pushLog("ok", `🎉 전체 시딩 완료 — 영상 ${queue.length}개 · 조회 ${queue.length * perVideoTotal}회 시딩`);
        setRunning(false); return;
      }
      const cur = queue[vi];
      setQueueIdx(vi + 1);
      setGhTarget(perVideoTotal); setGhDone(0); setGhElapsed(0);
      schedRef.current = { stop: false, timer: null, started: Date.now() };
      if (queue.length > 1) pushLog("sys", `━━━ 영상 ${vi + 1}/${queue.length} 시작 — ${cur.url} ━━━`);
      runGoldenHour(cur, perVideoTotal, jobId + "_v" + vi, () => { vi += 1; runVideo(); });
    };
    runVideo();
  }

  // ⏱️ 골든아워 곡선 — 30분 창을 n개 조회로 나누되 초반 집중→후반 성김(자연 성장곡선, 레드라인 회피).
  //   i번째 조회 시각 = W * (i/n)^k (k>1이면 초반 밀집). 여기선 k=1.7. 각 조회는 순차 실행(봇 1개).
  function scheduleAt(i: number, n: number): number {
    const k = 1.7;                                   // 곡선 강도(초반 몰빵 정도)
    const frac = Math.pow(i / Math.max(1, n), k);    // 0~1
    // 골든아워의 앞 85%(25.5분)에 물량을 뿌리고, 뒤 15%는 여운(중간중간 섞기 여지)
    return Math.floor(frac * GH_WINDOW * 0.85 * 1000); // ms
  }

  // 한 영상의 골든아워 곡선 실행(순차). 영상 물량 다 채우면 onVideoDone으로 다음 영상.
  function runGoldenHour(video: { url: string; type: "shorts" | "longform" }, total: number, jobId: string, onVideoDone: () => void) {
    let done = 0;
    const runNext = () => {
      if (schedRef.current.stop) { setRunning(false); return; }
      if (done >= total) {
        pushLog("ok", `${queueTotal > 1 ? "  " : ""}✅ 이 영상 골든아워 완료 — 조회 ${done}회`);
        onVideoDone(); return;
      }
      const idx = done;   // 0-based
      const started = schedRef.current.started;
      const targetMs = scheduleAt(idx, total);
      const waitMs = Math.max(0, targetMs - (Date.now() - started));
      schedRef.current.timer = setTimeout(() => {
        if (schedRef.current.stop) { setRunning(false); return; }
        setGhElapsed(Math.floor((Date.now() - started) / 1000));
        // 📊 몇 번째 시작 / 목표 / 완료 / 남음 — 매번 명확히 표시
        pushLog("sys", `▶️ ${idx + 1}번째 시작 · 목표 ${total} · 완료 ${done} · 남음 ${total - done}`);
        runOneView(video, jobId + "_" + idx, () => { done += 1; setGhDone(done); runNext(); });
      }, waitMs);
    };
    runNext();
  }

  // 조회 1건 실행(SSE) — 끝나면 onDone 콜백으로 다음 예약. 플랫폼별 봇/파라미터.
  function runOneView(video: { url: string; type: "shorts" | "longform" }, jobId: string, onDone: () => void) {
    const q = isYt
      ? new URLSearchParams({ videoUrl: video.url, videoType: video.type, gateway, watchSeconds: String(watchSeconds), nationality, headful: visible ? "1" : "0", jobId })
      : new URLSearchParams({ postUrl: video.url, contentType, gateway, watchSeconds: String(watchSeconds || 30), nationality, headful: visible ? "1" : "0", jobId });
    jobRef.current = jobId;
    try {
      const es = new BotEventStream(`${BOT}/api/seed/view?${q}`, { method: "GET" });
      esRef.current = es;
      let finished = false;
      const finish = () => { if (finished) return; finished = true; es.close(); esRef.current = null; onDone(); };
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.type === "log") pushLog("log", d.msg);
          else if (d.type === "seed_done") {
            pushLog(d.status === "success" ? "ok" : "err", d.status === "success" ? `✅ 조회 완료 (watch ${d.watchedSeconds}s)` : `❌ 실패: ${d.error || ""}`);
            setStats((s) => ({ views: s.views + (d.status === "success" ? 1 : 0), success: s.success + (d.status === "success" ? 1 : 0), fail: s.fail + (d.status === "success" ? 0 : 1) }));
            finish();
          } else if (d.type === "error") { pushLog("err", `❌ ${d.msg}`); finish(); }
        } catch {}
      };
      es.onerror = (detail) => { pushLog("err", `⚠️ 봇 연결 실패 — ${detail || "youtube-bot(3366) 실행 확인"}`); finish(); };
    } catch (e: any) { pushLog("err", `❌ 실행 실패: ${e.message}`); onDone(); }
  }

  // 📺 채널 주소 → 영상목록 불러오기(SSE). 완료 시 골든아워 영상 자동 선택.
  function loadChannel(target?: string) {
    const u = (target ?? channelUrl).trim();
    if (!u) { showToast?.("채널(계정) 주소를 입력하세요", "error"); return; }
    if (!isYt) { showToast?.("인스타 계정 불러오기는 준비 중이에요(STEP2)", "info"); return; }
    if (channelLoading) return;
    if (target && target !== channelUrl) setChannelUrl(target);
    // 불러온 계정은 자동 저장(사용자가 삭제 전엔 안 사라짐)
    if (!savedChannels.includes(u)) persistChannels([u, ...savedChannels].slice(0, 30));
    setChannelLoading(true);
    setChannelVideos([]); setSelectedIds(new Set()); setChannelSubs(undefined);
    pushLog("sys", `📺 채널 불러오기 시작 — ${u} (RSS+스크래핑 혼합, 오래 걸릴 수 있어요)`);
    const q = new URLSearchParams({ channelUrl: u, nationality });
    const es = new BotEventStream(`${YT_BOT}/api/channel/videos?${q}`, { method: "GET" });
    chanEsRef.current = es;
    let done = false;
    const finish = () => { if (done) return; done = true; es.close(); chanEsRef.current = null; setChannelLoading(false); };
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === "log") pushLog("log", d.msg);
        else if (d.type === "channel_done") {
          const vids: ChannelVideo[] = d.videos || [];
          setChannelVideos(vids);
          setChannelSubs(d.subscribers);
          const at = Date.now(); setChannelLoadedAt(at);
          // 결과 스냅샷 영속 — 크래시/재시작해도 리스트·수익화 진단 유지
          try {
            localStorage.setItem(`${CHAN_KEY}_vids`, JSON.stringify(vids));
            localStorage.setItem(`${CHAN_KEY}_subs`, String(d.subscribers ?? ""));
            localStorage.setItem(`${CHAN_KEY}_at`, String(at));
          } catch {}
          const golden = vids.filter(isGolden).map((v) => v.videoId);
          setSelectedIds(new Set(golden));   // 골든아워(30분 이내) 자동 선택
          const nShorts = vids.filter((v) => v.type === "shorts").length;
          pushLog("ok", `✅ ${vids.length}개 불러옴 (쇼츠 ${nShorts}·롱폼 ${vids.length - nShorts})${d.subscribers != null ? ` · 구독자 ${Number(d.subscribers).toLocaleString()}` : ""}${golden.length ? ` · 🔥골든아워 ${golden.length}개 자동선택` : ""}`);
          finish();
        } else if (d.type === "error") { pushLog("err", `❌ ${d.msg}`); finish(); }
      } catch {}
    };
    es.onerror = (detail: any) => { pushLog("err", `⚠️ 채널 불러오기 실패 — ${detail || "youtube-bot(3366) 실행 확인"}`); finish(); };
  }
  // 선택 헬퍼 (toggleSel은 useCallback — VideoSection memo 유지 위해 참조 고정)
  const toggleSel = useCallback((id: string) => setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const selectAll = () => setSelectedIds(new Set(channelVideos.map((v) => v.videoId)));
  const selectNone = () => setSelectedIds(new Set());
  const selectType = (t: "shorts" | "longform") => setSelectedIds(new Set(channelVideos.filter((v) => v.type === t).map((v) => v.videoId)));
  const selectGolden = () => setSelectedIds(new Set(channelVideos.filter(isGolden).map((v) => v.videoId)));

  function stop() {
    schedRef.current.stop = true;
    if (schedRef.current.timer) { clearTimeout(schedRef.current.timer); schedRef.current.timer = null; }
    esRef.current?.close(); esRef.current = null;
    if (jobRef.current) botFetch(`${BOT}/api/stop/${jobRef.current}`, { method: "POST" }).catch(() => {});
    setRunning(false);
    pushLog("sys", "⏹ 시딩을 정지했어요.");
  }
  const copyLog = () => {
    navigator.clipboard.writeText(logs.map((l) => `[${new Date(l.t).toLocaleTimeString("ko-KR", { hour12: false })}] ${l.msg}`).join("\n"))
      .then(() => showToast?.("로그를 복사했어요", "success")).catch(() => showToast?.("복사 실패", "error"));
  };
  const clearLog = () => setLogs([{ t: Date.now(), kind: "sys", msg: "로그를 비웠어요." }]);

  // 📺 채널 영상 정렬/분리(최근순·오래된순 + 🔥골든아워/쇼츠/롱폼 섹션)
  //  ★ useMemo — 실행 중 매초 리렌더에도 수백 개 재정렬 안 하게(크래시 방지 핵심)
  const sortedVideos = useMemo(() => [...channelVideos].sort((a, b) => {
    const ta = a.publishedAt ?? -1, tb = b.publishedAt ?? -1;
    return sortOrder === "recent" ? tb - ta : ta - tb;
  }), [channelVideos, sortOrder]);
  const goldenList = useMemo(() => sortedVideos.filter(isGolden), [sortedVideos]);
  const shortsList = useMemo(() => sortedVideos.filter((v) => v.type === "shorts" && !isGolden(v)), [sortedVideos]);
  const longList = useMemo(() => sortedVideos.filter((v) => v.type === "longform" && !isGolden(v)), [sortedVideos]);
  const selCount = selectedIds.size;

  // 📊 목표/완료/남음 — 실행 중이든 아니든 항상 표시(테리 지시). 대기 상태면 켠 조회 물량을 목표로 미리보기.
  const previewTarget = actions["view"]?.on ? (actions["view"].qty || 0) : 0;
  const targetNow = running ? ghTarget : previewTarget;
  const doneNow = running ? ghDone : 0;
  const remainNow = Math.max(0, targetNow - doneNow);
  const kpis = [
    { label: "목표", value: targetNow, unit: "회", tint: T.gold },
    { label: "완료", value: doneNow, unit: "회", tint: "#7dd88a" },
    { label: "남음", value: remainNow, unit: "회", tint: T.goldDim },
    { label: "실패", value: stats.fail, unit: "", tint: "#ff7a7a" },
  ];

  return (
    <div>
      {/* KPI — 플랫폼별 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: `linear-gradient(140deg,${T.panel2},${T.panel})`, border: `1px solid ${T.line}`, borderRadius: 14, padding: "12px 13px" }}>
            <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 24, color: k.tint, lineHeight: 1 }}>
              {k.value}<span style={{ fontSize: 12, color: T.sub, marginLeft: 3, fontWeight: 600 }}>{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ⏱️ 골든아워 진행바 — 실행 중일 때 (30분 창 + 물량 진행률) */}
      {running && ghTarget > 0 && (() => {
        const remainSec = Math.max(0, GH_WINDOW - ghElapsed);
        const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
        const ss = String(remainSec % 60).padStart(2, "0");
        const qtyPct = Math.min(100, Math.round((ghDone / ghTarget) * 100));
        const timePct = Math.min(100, Math.round((ghElapsed / GH_WINDOW) * 100));
        return (
          <div style={{ background: `linear-gradient(140deg,${T.panel2},${T.panel})`, border: `1px solid ${T.gold}`, borderRadius: 14, padding: "13px 15px", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: T.gold }}>⏱️ 골든아워 진행 중{queueTotal > 1 ? ` · 영상 ${queueIdx}/${queueTotal}` : ""}</span>
              <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 700 }}>조회 {ghDone}/{ghTarget}회 · 초반 집중→테이퍼링</span>
              <span style={{ marginLeft: "auto", fontFamily: F_MONO, fontSize: 13, fontWeight: 800, color: T.ink }}>남은 {mm}:{ss}</span>
            </div>
            {/* 물량 진행바 */}
            <div style={{ height: 8, borderRadius: 99, background: T.line, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ height: "100%", width: `${qtyPct}%`, borderRadius: 99, background: `linear-gradient(90deg,${T.gold},${T.goldDim})`, transition: "width .4s" }} />
            </div>
            {/* 시간 진행바(30분) */}
            <div style={{ height: 4, borderRadius: 99, background: T.line, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${timePct}%`, borderRadius: 99, background: "#7dd88a", transition: "width 1s linear" }} />
            </div>
          </div>
        );
      })()}

      {/* 📺 채널 영상 불러오기 (유튜브 전용) — 채널 주소 → 목록 → 골라서 전체 시딩 */}
      {isYt && (
        <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: T.gold, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            📺 내 채널 영상 불러오기
          </div>
          <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 10, lineHeight: 1.5 }}>
            채널 주소(@핸들·/channel/… 등)를 넣으면 영상을 <b style={{ color: T.ink }}>쇼츠/롱폼으로 나눠</b> 불러와요.
            🔥골든아워(업로드 30분 이내)는 <b style={{ color: T.ink }}>자동 선택</b>돼요. 골라서(또는 전체) 한 번에 시딩합니다.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)}
              placeholder={isYt ? "유튜브 채널 주소 (예: youtube.com/@핸들)" : "인스타 계정 주소 (준비 중)"}
              style={{ flex: 1, minWidth: 160, boxSizing: "border-box", padding: "11px 13px", borderRadius: 11, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 13.5, fontFamily: F_BODY, outline: "none" }} />
            <button onClick={saveChannel} title="이 계정 저장(삭제 전엔 유지)"
              style={{ flexShrink: 0, padding: "0 14px", borderRadius: 11, border: `1px solid ${T.gold}`, background: T.goldGlow, color: T.gold, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>💾 계정저장</button>
            <button onClick={() => loadChannel()} disabled={channelLoading}
              style={{ flexShrink: 0, padding: "0 16px", borderRadius: 11, border: `1px solid ${T.gold}`, background: channelLoading ? T.panel2 : T.gold, color: channelLoading ? T.sub : "#1a1408", fontSize: 13, fontWeight: 800, cursor: channelLoading ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              {channelLoading ? "⏳ 불러오는 중…" : "📥 영상 불러오기"}
            </button>
          </div>

          {/* 💾 저장된 내 계정 — 클릭하면 불러와요(사용자가 삭제 전엔 안 사라짐) */}
          {savedChannels.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 6, fontWeight: 700 }}>💾 저장된 내 계정 (클릭=불러오기 · 삭제 전엔 유지)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {savedChannels.map((c) => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 6, background: channelUrl === c ? T.goldGlow : T.panel2, border: `1px solid ${channelUrl === c ? T.gold : T.line}`, borderRadius: 9, padding: "7px 9px" }}>
                    <span onClick={() => loadChannel(c)} title={c} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: T.ink, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: F_MONO }}>{c}</span>
                    <button onClick={() => loadChannel(c)} disabled={channelLoading} style={{ flexShrink: 0, padding: "3px 10px", borderRadius: 7, border: "none", background: T.gold, color: "#1a1408", fontSize: 11, fontWeight: 800, cursor: channelLoading ? "default" : "pointer", fontFamily: "inherit" }}>불러오기</button>
                    <button onClick={() => removeChannel(c)} title="계정 삭제" style={{ flexShrink: 0, padding: "3px 8px", borderRadius: 7, border: `1px solid ${T.line}`, background: "transparent", color: T.sub, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {channelVideos.length > 0 && (
            <>
              {/* 상단 바: 구독자 · 정렬 · 전체선택 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {channelSubs != null && <span style={{ fontSize: 11, color: T.sub }}>👥 구독자 <b style={{ color: T.ink }}>{channelSubs.toLocaleString()}</b></span>}
                <span style={{ fontSize: 11, color: T.sub }}>총 <b style={{ color: T.ink }}>{channelVideos.length}</b>개</span>
                {channelLoadedAt && <span style={{ fontSize: 10, color: T.sub }} title="실시간이 아니라, 불러온 그 시점의 스냅샷이에요">📸 {Math.max(0, Math.floor((Date.now() - channelLoadedAt) / 60000))}분 전 측정(스냅샷)</span>}
                <button onClick={() => loadChannel()} disabled={channelLoading} title="지금 다시 측정(스냅샷 갱신)"
                  style={{ padding: "4px 10px", borderRadius: 8, border: `1px solid ${T.gold}`, background: T.goldGlow, color: T.gold, fontSize: 10.5, fontWeight: 800, cursor: channelLoading ? "default" : "pointer", fontFamily: "inherit" }}>🔄 새로고침</button>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4, background: T.panel2, borderRadius: 9, padding: 3, border: `1px solid ${T.line}` }}>
                  {([["recent", "최근순"], ["old", "오래된순"]] as [("recent" | "old"), string][]).map(([v, lbl]) => (
                    <button key={v} onClick={() => setSortOrder(v)} style={{ padding: "5px 11px", borderRadius: 7, border: "none", cursor: "pointer", background: sortOrder === v ? T.gold : "transparent", color: sortOrder === v ? "#1a1408" : T.sub, fontWeight: 700, fontSize: 11.5 }}>{lbl}</button>
                  ))}
                </div>
              </div>
              {/* 선택 버튼바 */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <SelBtn onClick={selectAll} T={T}>전체지정</SelBtn>
                <SelBtn onClick={selectNone} T={T}>전체해제</SelBtn>
                <SelBtn onClick={() => selectType("shorts")} T={T}>🎬 쇼츠만</SelBtn>
                <SelBtn onClick={() => selectType("longform")} T={T}>▶️ 롱폼만</SelBtn>
                {goldenList.length > 0 && <SelBtn onClick={selectGolden} T={T} accent>🔥 골든아워만</SelBtn>}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.gold, fontWeight: 800, alignSelf: "center" }}>
                  선택 {selCount}개{selCount > 0 ? ` · 예상 약 ${selCount * 30}분(순차)` : ""}
                </span>
              </div>
              {/* 리스트 — 🔥골든아워 / 쇼츠 / 롱폼 */}
              <div style={{ maxHeight: 320, overflowY: "auto", paddingRight: 2 }}>
                {goldenList.length > 0 && (
                  <VideoSection title="🔥 골든아워 (지금 밀면 노출 최대)" color={T.gold} list={goldenList} selectedIds={selectedIds} onToggle={toggleSel} T={T} golden />
                )}
                {shortsList.length > 0 && (
                  <VideoSection title="🎬 쇼츠" color={T.yt} list={shortsList} selectedIds={selectedIds} onToggle={toggleSel} T={T} />
                )}
                {longList.length > 0 && (
                  <VideoSection title="▶️ 롱폼" color={T.ink} list={longList} selectedIds={selectedIds} onToggle={toggleSel} T={T} />
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 💰 수익화(YPP) 진단 — 채널 불러온 뒤(유튜브) */}
      {isYt && channelVideos.length > 0 && (
        <MonetizeCoach videos={channelVideos} subscribers={channelSubs} T={T} perVideoViews={actions["view"]?.qty || 300} />
      )}

      {/* 실행 패널 */}
      <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 8 }}>{isYt ? "또는 영상 URL 하나만 직접 시딩" : "게시물 URL"}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)}
            placeholder={isYt ? "유튜브 영상/쇼츠 URL 붙여넣기" : "인스타 게시물/릴스 URL 붙여넣기"}
            style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "11px 13px", borderRadius: 11, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 13.5, fontFamily: F_BODY, outline: "none" }} />
          <button onClick={saveCurrentUrl} title="이 링크 저장" style={{ flexShrink: 0, padding: "0 14px", borderRadius: 11, border: `1px solid ${T.gold}`, background: T.goldGlow, color: T.gold, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>💾 저장</button>
        </div>

        {/* 💾 저장된 링크 — 클릭하면 바로 입력(매번 붙여넣기 안 해도 됨) */}
        {savedUrls.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 6, fontWeight: 700 }}>💾 저장된 링크 (클릭하면 바로 넣어요)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {savedUrls.map((u) => (
                <div key={u} style={{ display: "flex", alignItems: "center", gap: 6, background: videoUrl === u ? T.goldGlow : T.panel2, border: `1px solid ${videoUrl === u ? T.gold : T.line}`, borderRadius: 9, padding: "7px 9px" }}>
                  <span onClick={() => setVideoUrl(u)} title={u} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: T.ink, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: F_MONO }}>{u}</span>
                  <button onClick={() => setVideoUrl(u)} style={{ flexShrink: 0, padding: "3px 9px", borderRadius: 7, border: "none", background: T.gold, color: "#1a1408", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>넣기</button>
                  <button onClick={() => removeSavedUrl(u)} title="삭제" style={{ flexShrink: 0, padding: "3px 8px", borderRadius: 7, border: `1px solid ${T.line}`, background: "transparent", color: T.sub, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Seg label="콘텐츠" value={contentType} opts={CONTENT[platform]} onPick={setContentType} accent={accent} T={T} />
          <Seg label="국적(계정풀)" value={nationality} opts={[["kr", "🇰🇷 한국인"], ["foreign", "🌍 외국인"]]} onPick={(v) => setNationality(v as Nationality)} accent={accent} T={T} />
          <Seg label="게이트웨이" value={gateway} opts={[["instagram", "인스타"], ["facebook", "페북"], ["direct", "직접"]]} onPick={(v) => setGateway(v as Gateway)} accent={accent} T={T} />
          {isYt && contentType === "longform" && (
            <div>
              <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 5 }}>시청(초)</div>
              <input type="number" value={watchSeconds} min={30} max={600} onChange={(e) => setWatchSeconds(Math.max(30, +e.target.value || 60))}
                style={{ width: 74, padding: "7px 9px", borderRadius: 9, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 13, outline: "none" }} />
            </div>
          )}
        </div>

        {/* 액션 다중선택 + 물량 */}
        <div style={{ fontSize: 11, color: T.sub, fontWeight: 700, marginBottom: 8, letterSpacing: ".02em" }}>⚡ 액션 — 켜고 골든아워 물량 설정</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8, marginBottom: commentOn ? 12 : 4 }}>
          {defs.map((d) => {
            const st = actions[d.id];
            return (
              <div key={d.id} title={d.desc || ""} style={{
                border: `1px solid ${st.on ? T.gold : T.line}`, borderRadius: 11, padding: "9px 10px",
                background: st.on ? T.goldGlow : T.panel2, transition: "all .15s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <button onClick={() => toggleAction(d.id)} style={{
                    width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${st.on ? T.gold : T.sub}`,
                    background: st.on ? T.gold : "transparent", color: "#1a1408", cursor: "pointer",
                    fontSize: 12, fontWeight: 900, lineHeight: 1, display: "grid", placeItems: "center", flexShrink: 0,
                  }}>{st.on ? "✓" : ""}</button>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{d.icon} {d.label}</span>
                  {d.ai && <MascotBot size={16} style={{ marginLeft: "auto" }} />}
                </div>
                <input type="number" value={st.qty} min={0} max={limitOf(d.id) || undefined} disabled={!st.on} onChange={(e) => setQty(d.id, +e.target.value || 0)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "5px 8px", borderRadius: 7, border: `1px solid ${T.line}`, background: dark ? "#0f0b15" : "#fff", color: T.ink, fontSize: 12.5, fontFamily: F_MONO, outline: "none", opacity: st.on ? 1 : 0.4 }} />
                {/* 등급 물량 상한 표시(무제한=∞) */}
                <div style={{ fontSize: 9.5, color: T.sub, marginTop: 3, fontWeight: 600, textAlign: "right" }}>
                  상한 {limitOf(d.id) > 0 ? limitOf(d.id).toLocaleString() : "∞"}{gsPlan !== "unlimited" ? ` · ${GS_PLAN_LABEL[gsPlan]}` : ""}
                </div>
                {d.warn && st.on && <div style={{ fontSize: 9.5, color: "#ff9e6b", marginTop: 4, lineHeight: 1.3 }}>⚠️ {d.warn}</div>}
              </div>
            );
          })}
        </div>

        {/* AI 키 — 댓글 켜졌을 때 */}
        {commentOn && (
          <div style={{ background: T.panel2, border: `1px solid ${T.gold}`, borderRadius: 11, padding: "10px 12px", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
              <MascotBot size={20} />
              <span style={{ fontSize: 12, fontWeight: 700, color: T.gold }}>AI 댓글 키 — 콘텐츠를 보고 자연 댓글 생성</span>
            </div>
            <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="Gemini API 키 입력"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 8, border: `1px solid ${T.line}`, background: dark ? "#0f0b15" : "#fff", color: T.ink, fontSize: 12.5, fontFamily: F_MONO, outline: "none" }} />
          </div>
        )}
      </div>

      {/* ▶ 실행 컨트롤 — 로그와 분리된 독립 버튼바(테리 지시: 시작/정지/창보기는 로그 밖에. 이어서는 트래픽처럼 제거) */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {!running
          ? <RunBtn onClick={start} T={T} title="시딩 시작" primary>▶ 시딩 시작</RunBtn>
          : <RunBtn onClick={stop} T={T} title="정지" danger>■ 정지</RunBtn>}
        <RunBtn onClick={() => { setVisible((v) => !v); showToast?.(visible ? "창 보기 끔" : "창 보기 켬 — 다음 실행부터 봇 창 표시", "info"); }} T={T} active={visible} title="실제 봇 브라우저 창 보기">🚪 창 보기</RunBtn>
      </div>

      {/* 로그창 — 트래픽식 버튼바 + 디테일 로그 (플랫폼별) */}
      <div style={{ background: T.logBg, border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", borderBottom: `1px solid ${T.line}`, background: "rgba(255,255,255,.02)", flexWrap: "wrap" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: running ? "#7dd88a" : T.sub, boxShadow: running ? "0 0 8px #7dd88a" : "none" }} />
          <span style={{ fontSize: 11.5, color: "#d8cdb4", fontFamily: F_MONO, letterSpacing: ".03em", marginRight: "auto" }}>
            LIVE LOG · <span style={{ color: isYt ? "#ff6b6b" : T.gold, fontWeight: 800 }}>{isYt ? "유튜브" : "인스타"}</span>
          </span>
          {/* 로그 관련 버튼만 — 실행(시작/정지)은 로그 밖 별도 버튼바로 분리 */}
          <LogBtn onClick={() => setLogZoom(true)} T={T} title="로그 크게 보기">🔍 크게보기</LogBtn>
          <LogBtn onClick={copyLog} T={T} title="로그 복사">📋 복사</LogBtn>
          <LogBtn onClick={clearLog} T={T} title="로그 지우기">🧹 비우기</LogBtn>
        </div>
        <div style={{ maxHeight: 190, overflowY: "auto", padding: "10px 13px", fontFamily: F_MONO, fontSize: 12, lineHeight: 1.75 }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.kind === "ok" ? "#7dd88a" : l.kind === "err" ? "#ff7a7a" : l.kind === "sys" ? T.gold : "#d8cdb4" }}>
              <span style={{ color: "#6b6350", marginRight: 8 }}>{new Date(l.t).toLocaleTimeString("ko-KR", { hour12: false })}</span>{l.msg}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* 🔍 로그 크게 보기 — 앱 내 모달(별도 창 아님, 트래픽 계승) */}
      {logZoom && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setLogZoom(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(8,6,3,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: "min(4vw,30px)" }}>
          <div style={{ width: "100%", maxWidth: 1000, height: "86vh", background: T.logBg, border: `1px solid ${T.line}`, borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.55)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "13px 16px", borderBottom: `1px solid ${T.line}`, flexWrap: "wrap" }}>
              <b style={{ color: "#e8dcc0", fontSize: 14.5, fontFamily: F_MONO }}>📜 {isYt ? "유튜브" : "인스타"} 실시간 로그 — 크게 보기</b>
              <div style={{ display: "flex", gap: 8 }}>
                <LogBtn onClick={copyLog} T={T} title="로그 복사">📋 복사</LogBtn>
                <LogBtn onClick={() => setLogZoom(false)} T={T} title="닫기" accent>닫기</LogBtn>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", fontFamily: F_MONO, fontSize: 14, lineHeight: 1.9 }}>
              {logs.map((l, i) => (
                <div key={i} style={{ color: l.kind === "ok" ? "#7dd88a" : l.kind === "err" ? "#ff7a7a" : l.kind === "sys" ? T.gold : "#d8cdb4" }}>
                  <span style={{ color: "#6b6350", marginRight: 10 }}>{new Date(l.t).toLocaleTimeString("ko-KR", { hour12: false })}</span>{l.msg}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ▶ 실행 컨트롤 버튼 (로그창과 분리된 큰 버튼)
function RunBtn({ children, onClick, T, title, primary, danger, active, disabled }: any) {
  const bg = disabled ? T.panel2 : danger ? "rgba(255,59,59,.12)" : primary ? T.gold : active ? T.goldGlow : T.panel;
  const color = disabled ? T.sub : danger ? T.yt : primary ? "#1a1408" : active ? T.gold : T.ink;
  const border = danger ? T.yt : primary ? T.gold : active ? T.gold : T.line;
  return (
    <button onClick={disabled ? undefined : onClick} title={title} disabled={disabled} style={{
      flex: primary || danger ? 1 : "0 0 auto", minWidth: primary || danger ? 140 : 0,
      padding: "12px 20px", borderRadius: 12, border: `1.5px solid ${border}`, background: bg, color,
      fontSize: 14, fontWeight: 800, cursor: disabled ? "default" : "pointer", fontFamily: F_DISPLAY,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7, transition: "all .15s",
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}

// 로그창 버튼
function LogBtn({ children, onClick, T, title, active, accent, danger }: any) {
  const border = danger ? T.yt : accent ? T.gold : active ? T.gold : T.line;
  const color = danger ? T.yt : accent ? "#1a1408" : active ? T.gold : "#d8cdb4";
  const bg = accent ? T.gold : active ? T.goldGlow : "rgba(255,255,255,.04)";
  return (
    <button onClick={onClick} title={title} style={{
      padding: "4px 9px", borderRadius: 7, border: `1px solid ${border}`, background: bg, color,
      fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

// 선택 버튼(전체지정/해제 등)
function SelBtn({ children, onClick, T, accent }: any) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 11px", borderRadius: 8, cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit",
      border: `1px solid ${accent ? T.gold : T.line}`, background: accent ? T.goldGlow : T.panel2, color: accent ? T.gold : T.ink,
    }}>{children}</button>
  );
}

// 영상 섹션(🔥골든아워/쇼츠/롱폼) — 체크박스 리스트
// ★ memo — 실행 중(매초 리렌더) 리스트가 다시 안 그려지게(수백 썸네일 재렌더=크래시 원인 차단)
const VideoSection = memo(function VideoSection({ title, color, list, selectedIds, onToggle, T, golden }: {
  title: string; color: string; list: ChannelVideo[]; selectedIds: Set<string>; onToggle: (id: string) => void; T: any; golden?: boolean;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color, margin: "6px 0 6px" }}>{title} ({list.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {list.map((v) => {
          const on = selectedIds.has(v.videoId);
          return (
            <div key={v.videoId} onClick={() => onToggle(v.videoId)} title={v.title} style={{
              display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 10, cursor: "pointer",
              border: `1px solid ${on ? T.gold : T.line}`, background: on ? T.goldGlow : T.panel2, transition: "all .12s",
            }}>
              <span style={{
                width: 17, height: 17, flexShrink: 0, borderRadius: 5, border: `1.5px solid ${on ? T.gold : T.sub}`,
                background: on ? T.gold : "transparent", color: "#1a1408", fontSize: 11, fontWeight: 900,
                display: "grid", placeItems: "center",
              }}>{on ? "✓" : ""}</span>
              <img src={v.thumb} alt="" loading="lazy" decoding="async" style={{ width: 64, height: 36, flexShrink: 0, objectFit: "cover", borderRadius: 6, background: T.line }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: T.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</div>
                <div style={{ fontSize: 10, color: T.sub, marginTop: 2, display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {golden && <span style={{ color: T.gold, fontWeight: 800 }}>🔥 {fmtAgo(v)}</span>}
                  {!golden && fmtAgo(v) && <span>{fmtAgo(v)}</span>}
                  {v.durationSec != null && <span>⏱ {fmtDur(v.durationSec)}</span>}
                  {v.views != null && <span>👁 {v.views.toLocaleString()}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// 세그먼트 선택
function Seg({ label, value, opts, onPick, accent, T }: { label: string; value: string; opts: [string, string][]; onPick: (v: string) => void; accent: string; T: any }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, background: T.panel2, borderRadius: 9, padding: 3, border: `1px solid ${T.line}` }}>
        {opts.map(([v, lbl]) => {
          const on = value === v;
          return (
            <button key={v} onClick={() => onPick(v)} style={{
              padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer",
              background: on ? accent : "transparent", color: on ? "#1a1408" : T.sub,
              fontWeight: 700, fontSize: 12.5, transition: "all .15s", whiteSpace: "nowrap",
            }}>{lbl}</button>
          );
        })}
      </div>
    </div>
  );
}
