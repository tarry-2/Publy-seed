import { useState, useRef, useEffect } from "react";
import { BotEventStream, botFetch } from "../lib/botApi";
import MascotBot from "./MascotBot";

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
const F_DISPLAY = "'Sora', ui-sans-serif, system-ui, sans-serif";
const F_BODY = "'Pretendard', -apple-system, system-ui, sans-serif";
const F_MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace";

type Platform = "youtube" | "instagram";
type Nationality = "kr" | "foreign";
type Gateway = "instagram" | "facebook" | "direct";
type LogLine = { t: number; kind: "log" | "ok" | "err" | "sys"; msg: string };

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
export default function SeedingCenter({ showToast, theme = "dark", approvedTools, allowedByTool }: {
  showToast?: (m: string, t?: any) => void;
  theme?: "light" | "dark";
  approvedTools?: string[];             // 승인된 플랫폼(없으면 전체 허용 = 관리자/미게이트 모드)
  allowedByTool?: Record<string, string[]>;  // 플랫폼별 승인된 액션 id 배열
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
          <SeedingPanel platform="youtube" showToast={showToast} T={T} dark={dark} allowedActions={allowedByTool?.youtube} />
        </div>
      )}
      {platforms.includes("instagram") && (
        <div style={{ display: platform === "instagram" ? "block" : "none" }}>
          <SeedingPanel platform="instagram" showToast={showToast} T={T} dark={dark} allowedActions={allowedByTool?.instagram} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 플랫폼별 독립 패널 — 자기 URL·액션·로그·KPI·실행상태를 전부 따로 가진다
// ═══════════════════════════════════════════════════════════
function SeedingPanel({ platform, showToast, T, dark, allowedActions }: { platform: Platform; showToast?: (m: string, t?: any) => void; T: any; dark: boolean; allowedActions?: string[] }) {
  const isYt = platform === "youtube";
  const accent = isYt ? T.yt : T.gold;
  // 승인된 액션만 노출(allowedActions 없으면=미게이트/관리자 전체 허용)
  const gated = Array.isArray(allowedActions);
  const defs = gated ? ACTIONS[platform].filter(a => allowedActions!.includes(a.id)) : ACTIONS[platform];

  const [videoUrl, setVideoUrl] = useState("");
  const [contentType, setContentType] = useState<string>(isYt ? "shorts" : CONTENT[platform][0][0]);
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
  const esRef = useRef<BotEventStream | null>(null);
  const jobRef = useRef<string>("");
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => () => { esRef.current?.close(); }, []);

  const pushLog = (kind: LogLine["kind"], msg: string) => setLogs((l) => [...l.slice(-400), { t: Date.now(), kind, msg }]);
  const commentOn = actions["comment"]?.on;

  const toggleAction = (id: string) => setActions((a) => ({ ...a, [id]: { ...a[id], on: !a[id].on } }));
  const setQty = (id: string, v: number) => setActions((a) => ({ ...a, [id]: { ...a[id], qty: Math.max(0, v) } }));

  // ★트래픽 계승(2026-09-07 테리): '이어하기' 개념 제거 — 시작은 항상 새 설정으로 처음부터.
  //   (이어하기가 최초 설정을 물고 가서 수정한 설정이 무시되던 버그 방지.)
  function start() {
    if (running) return;
    if (!videoUrl.trim()) { showToast?.("URL을 입력하세요", "error"); return; }
    const picked = defs.filter((d) => actions[d.id]?.on && actions[d.id].qty > 0);
    if (!picked.length) { showToast?.("실행할 액션을 하나 이상 켜세요", "error"); return; }
    if (commentOn && !aiKey.trim()) { showToast?.("댓글은 AI 키가 필요해요", "error"); return; }

    setStats({ views: 0, success: 0, fail: 0 });
    const jobId = Date.now().toString();
    jobRef.current = jobId;
    setRunning(true);

    // ── 디테일 로그(1~N) — 트래픽처럼 단계별로 상세하게 ──
    pushLog("sys", `▶️ 시딩 시작 — ${isYt ? "유튜브" : "인스타"} · ${CONTENT[platform].find((c) => c[0] === contentType)?.[1]}`);
    pushLog("log", `🌐 대상 URL: ${videoUrl.trim()}`);
    pushLog("log", `🧭 게이트웨이: ${gateway === "instagram" ? "인스타 referrer" : gateway === "facebook" ? "페북 referrer" : "직접"} · 국적: ${nationality === "kr" ? "🇰🇷 한국인" : "🌍 외국인"} 계정풀`);
    pushLog("log", `🎯 선택 액션 ${picked.length}종: ${picked.map((d) => `${d.icon}${d.label}×${actions[d.id].qty}`).join(" · ")}`);
    if (visible) pushLog("log", "🚪 창 보기 ON — 봇 브라우저 창을 띄웁니다");

    // 🔴 인스타는 봇 미구현(STEP2+, 계정 로그인 필요) → 유튜브 봇으로 보내면 안 됨.
    if (!isYt) {
      pushLog("sys", "ℹ️ 인스타 시딩은 준비 중이에요(STEP2). 인스타는 로그인 계정이 있어야 해서, 계정 시스템이 붙은 뒤 열립니다. 지금은 유튜브 조회 시딩만 실행돼요.");
      picked.forEach((d) => pushLog("log", `⏳ ${d.icon} ${d.label} ×${actions[d.id].qty} — 인스타 계정 연결 후 실행`));
      setRunning(false);
      return;
    }

    // 조회(view)만 실제 봇 연동(STEP1). 나머지는 계정 붙는대로 순차 연결.
    if (actions["view"]?.on) {
      const q = new URLSearchParams({
        videoUrl: videoUrl.trim(), videoType: contentType === "longform" ? "longform" : "shorts",
        gateway, watchSeconds: String(watchSeconds), nationality, headful: visible ? "1" : "0", jobId,
      });
      try {
        const es = new BotEventStream(`${YT_BOT}/api/seed/view?${q}`, { method: "GET" });
        esRef.current = es;
        es.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data);
            if (d.type === "log") pushLog("log", d.msg);
            else if (d.type === "seed_done") {
              pushLog(d.status === "success" ? "ok" : "err", d.status === "success" ? `✅ 조회 완료 (watch ${d.watchedSeconds}s)` : `❌ 실패: ${d.error || ""}`);
              setStats((s) => ({ views: s.views + (d.status === "success" ? 1 : 0), success: s.success + (d.status === "success" ? 1 : 0), fail: s.fail + (d.status === "success" ? 0 : 1) }));
              stop();
            } else if (d.type === "error") { pushLog("err", `❌ ${d.msg}`); stop(); }
          } catch {}
        };
        es.onerror = (detail) => pushLog("err", `⚠️ 봇 연결 실패 — ${detail || "youtube-bot(3366) 실행 확인"}`);
        es.onclose = () => setRunning(false);
      } catch (e: any) { pushLog("err", `❌ 시작 실패: ${e.message}`); setRunning(false); }
    } else {
      pushLog("sys", "ℹ️ 조회 외 액션은 계정 워밍업(STEP2+) 후 연결됩니다 — 물량 설정은 저장돼요.");
      setRunning(false);
    }
    // 조회 외 선택 액션 안내(구현 예정)
    picked.filter((d) => d.id !== "view").forEach((d) => pushLog("log", `⏳ ${d.icon} ${d.label} ×${actions[d.id].qty} — 준비 중(계정 연결 후 실행)`));
  }

  function stop() {
    esRef.current?.close(); esRef.current = null;
    if (jobRef.current) botFetch(`${YT_BOT}/api/stop/${jobRef.current}`, { method: "POST" }).catch(() => {});
    setRunning(false);
  }
  const copyLog = () => {
    navigator.clipboard.writeText(logs.map((l) => `[${new Date(l.t).toLocaleTimeString("ko-KR", { hour12: false })}] ${l.msg}`).join("\n"))
      .then(() => showToast?.("로그를 복사했어요", "success")).catch(() => showToast?.("복사 실패", "error"));
  };
  const clearLog = () => setLogs([{ t: Date.now(), kind: "sys", msg: "로그를 비웠어요." }]);

  const kpis = [
    { label: "조회 시딩", value: stats.views, unit: "회", tint: T.gold },
    { label: "성공", value: stats.success, unit: "", tint: "#7dd88a" },
    { label: "실패", value: stats.fail, unit: "", tint: "#ff7a7a" },
    { label: "골든아워", value: 30, unit: "분", tint: T.goldDim },
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

      {/* 실행 패널 */}
      <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)}
          placeholder={isYt ? "유튜브 영상/쇼츠 URL 붙여넣기" : "인스타 게시물/릴스 URL 붙여넣기"}
          style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 11, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 13.5, fontFamily: F_BODY, outline: "none", marginBottom: 12 }} />

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
                <input type="number" value={st.qty} min={0} disabled={!st.on} onChange={(e) => setQty(d.id, +e.target.value || 0)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "5px 8px", borderRadius: 7, border: `1px solid ${T.line}`, background: dark ? "#0f0b15" : "#fff", color: T.ink, fontSize: 12.5, fontFamily: F_MONO, outline: "none", opacity: st.on ? 1 : 0.4 }} />
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
