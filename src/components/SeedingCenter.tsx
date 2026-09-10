import { useState, useRef, useEffect } from "react";

/* ───────────────────────────────────────────────────────────
   골든시드 시딩 컨트롤 (SeedingCenter)
   — 트래픽 InflowCenter의 관제탑 레이아웃 계승:
     KPI 지표 + 추이 + 실행패널 + 하단 다크 라이브 로그.
   — 탭: 유튜브 / 인스타 동시. 디자인 = 다크 럭셔리 + 골드(인플루언서 감성).
   — 봇 연동: youtube-bot(3366) /api/seed/view (SSE). 인스타는 STEP2+.
   ⚠️ 실제 유튜브 실행·DB로깅은 봇/Supabase 연동 후 실측 튜닝.
─────────────────────────────────────────────────────────── */

// 다크 럭셔리 팔레트 — 골드 액센트 + 플랫폼별 포인트
const T = {
  bg: "radial-gradient(1200px 600px at 15% -10%, #1c1608 0%, transparent 55%), radial-gradient(900px 500px at 110% 10%, #160f1e 0%, transparent 50%), #08070b",
  panel: "#131019",
  panel2: "#1b1725",
  line: "#2a2436",
  ink: "#f4efe4",
  sub: "#9a9284",
  gold: "#f5c451",
  goldDim: "#c9a03f",
  goldGlow: "rgba(245,196,81,.16)",
  logBg: "#0b0910",
  logInk: "#d8cdb4",
  yt: "#ff3b3b",
  igGrad: "linear-gradient(90deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)",
};

const F_DISPLAY = "'Sora', ui-sans-serif, system-ui, sans-serif";
const F_BODY = "'Pretendard', -apple-system, system-ui, sans-serif";
const F_MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace";

type Platform = "youtube" | "instagram";
type VideoType = "shorts" | "longform";
type Gateway = "instagram" | "facebook" | "direct";
type LogLine = { t: number; kind: "log" | "ok" | "err" | "sys"; msg: string };

const YT_BOT = "http://localhost:3366";

export default function SeedingCenter({ showToast }: { showToast?: (m: string, t?: any) => void }) {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoType, setVideoType] = useState<VideoType>("shorts");
  const [gateway, setGateway] = useState<Gateway>("instagram");
  const [watchSeconds, setWatchSeconds] = useState(60);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([
    { t: Date.now(), kind: "sys", msg: "골든시드 시딩 콘솔 준비됨. 골든아워(첫 30분)에 시딩하세요." },
  ]);
  const [stats, setStats] = useState({ views: 0, success: 0, fail: 0 });
  const esRef = useRef<EventSource | null>(null);
  const jobRef = useRef<string>("");
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => () => { esRef.current?.close(); }, []);

  const pushLog = (kind: LogLine["kind"], msg: string) =>
    setLogs((l) => [...l.slice(-300), { t: Date.now(), kind, msg }]);

  const accent = platform === "youtube" ? T.yt : T.gold;

  function start() {
    if (running) return;
    if (platform === "instagram") {
      showToast?.("인스타 시딩은 STEP2에서 열립니다 (계정 워밍업 후)", "info");
      pushLog("sys", "ℹ️ 인스타 시딩은 준비 중 — 지금은 유튜브 조회 시딩만 가능.");
      return;
    }
    if (!videoUrl.trim()) { showToast?.("영상 URL을 입력하세요", "error"); return; }

    const jobId = Date.now().toString();
    jobRef.current = jobId;
    const q = new URLSearchParams({
      videoUrl: videoUrl.trim(), videoType, gateway,
      watchSeconds: String(watchSeconds), jobId,
    });
    setRunning(true);
    pushLog("sys", `▶️ 조회 시딩 시작 — [${videoType}] ${gateway} 게이트웨이`);

    try {
      const es = new EventSource(`${YT_BOT}/api/seed/view?${q}`);
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.type === "log") pushLog("log", d.msg);
          else if (d.type === "seed_done") {
            pushLog(d.status === "success" ? "ok" : "err",
              d.status === "success" ? `✅ 완료 (watch ${d.watchedSeconds}s)` : `❌ 실패: ${d.error || ""}`);
            setStats((s) => ({
              views: s.views + (d.status === "success" ? 1 : 0),
              success: s.success + (d.status === "success" ? 1 : 0),
              fail: s.fail + (d.status === "success" ? 0 : 1),
            }));
            stop();
          } else if (d.type === "error") { pushLog("err", `❌ ${d.msg}`); stop(); }
        } catch {}
      };
      es.onerror = () => {
        pushLog("err", "⚠️ 봇 서버 연결 끊김 — youtube-bot(3366)이 실행 중인지 확인하세요.");
        stop();
      };
    } catch (e: any) {
      pushLog("err", `❌ 시작 실패: ${e.message}`);
      setRunning(false);
    }
  }

  function stop() {
    esRef.current?.close();
    esRef.current = null;
    if (jobRef.current) fetch(`${YT_BOT}/api/stop/${jobRef.current}`, { method: "POST" }).catch(() => {});
    setRunning(false);
  }

  const kpis = [
    { label: "조회 시딩", value: stats.views, unit: "회", tint: T.gold },
    { label: "성공", value: stats.success, unit: "", tint: "#7dd88a" },
    { label: "실패", value: stats.fail, unit: "", tint: "#ff7a7a" },
    { label: "골든아워", value: 30, unit: "분", tint: T.goldDim },
  ];

  return (
    <div style={{ minHeight: "100%", background: T.bg, color: T.ink, fontFamily: F_BODY, padding: "18px 20px 24px" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center",
          background: `linear-gradient(135deg,${T.gold},${T.goldDim})`, boxShadow: `0 6px 20px ${T.goldGlow}`,
          fontSize: 18,
        }}>🌱</div>
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 19, letterSpacing: "-.02em" }}>
            GoldenSeed <span style={{ color: T.gold }}>시딩 콘솔</span>
          </div>
          <div style={{ fontSize: 11.5, color: T.sub, marginTop: 1 }}>골든아워 초기시딩 — 조회·좋아요·댓글을 임계선 밑에서 자연스럽게</div>
        </div>
      </div>

      {/* 플랫폼 탭 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["youtube", "instagram"] as Platform[]).map((p) => {
          const on = platform === p;
          const isYt = p === "youtube";
          return (
            <button key={p} onClick={() => setPlatform(p)} style={{
              flex: 1, padding: "11px 14px", borderRadius: 12, cursor: "pointer",
              border: `1px solid ${on ? (isYt ? T.yt : T.gold) : T.line}`,
              background: on ? (isYt ? "rgba(255,59,59,.10)" : T.goldGlow) : T.panel,
              color: on ? T.ink : T.sub, fontWeight: 700, fontFamily: F_DISPLAY, fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all .18s",
            }}>
              <span style={{
                width: 9, height: 9, borderRadius: 3,
                background: isYt ? T.yt : T.igGrad,
              }} />
              {isYt ? "유튜브" : "인스타"}
              {p === "instagram" && <span style={{ fontSize: 10, color: T.sub, fontWeight: 600 }}>(준비중)</span>}
            </button>
          );
        })}
      </div>

      {/* KPI 카드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{
            background: `linear-gradient(140deg,${T.panel2},${T.panel})`, border: `1px solid ${T.line}`,
            borderRadius: 14, padding: "12px 13px",
          }}>
            <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 6, letterSpacing: ".02em" }}>{k.label}</div>
            <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 24, color: k.tint, lineHeight: 1 }}>
              {k.value}<span style={{ fontSize: 12, color: T.sub, marginLeft: 3, fontWeight: 600 }}>{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 실행 패널 */}
      <div style={{
        background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 10, fontWeight: 700, letterSpacing: ".02em" }}>
          🎯 캠페인 — 영상 하나를 골든아워에 시딩
        </div>
        <input
          value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)}
          placeholder={platform === "youtube" ? "유튜브 영상/쇼츠 URL 붙여넣기" : "인스타 릴스 URL (준비중)"}
          style={{
            width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 11,
            border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 13.5,
            fontFamily: F_BODY, outline: "none", marginBottom: 11,
          }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {/* 영상 타입 */}
          <Seg label="유형" value={videoType} opts={[["shorts", "쇼츠"], ["longform", "롱폼"]]} onPick={(v) => setVideoType(v as VideoType)} accent={accent} />
          {/* 게이트웨이 */}
          <Seg label="게이트웨이" value={gateway} opts={[["instagram", "인스타"], ["facebook", "페북"], ["direct", "직접"]]} onPick={(v) => setGateway(v as Gateway)} accent={accent} />
          {videoType === "longform" && (
            <div>
              <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 5 }}>시청(초)</div>
              <input type="number" value={watchSeconds} min={30} max={600}
                onChange={(e) => setWatchSeconds(Math.max(30, +e.target.value || 60))}
                style={{ width: 74, padding: "7px 9px", borderRadius: 9, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 13, outline: "none" }} />
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={start} disabled={running} style={{
            flex: 1, padding: "12px", borderRadius: 12, border: "none", cursor: running ? "default" : "pointer",
            background: running ? T.line : `linear-gradient(135deg,${T.gold},${T.goldDim})`,
            color: running ? T.sub : "#1a1408", fontWeight: 800, fontFamily: F_DISPLAY, fontSize: 14.5,
            boxShadow: running ? "none" : `0 8px 24px ${T.goldGlow}`, transition: "all .18s",
          }}>
            {running ? "시딩 진행 중…" : "▶ 시딩 시작"}
          </button>
          {running && (
            <button onClick={stop} style={{
              padding: "12px 20px", borderRadius: 12, border: `1px solid ${T.yt}`, cursor: "pointer",
              background: "rgba(255,59,59,.10)", color: T.yt, fontWeight: 700, fontFamily: F_DISPLAY, fontSize: 14,
            }}>■ 중단</button>
          )}
        </div>
      </div>

      {/* 하단 라이브 로그 (트래픽 계승, 다크 터미널 럭셔리) */}
      <div style={{ background: T.logBg, border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "9px 13px",
          borderBottom: `1px solid ${T.line}`, background: "rgba(255,255,255,.02)",
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: running ? "#7dd88a" : T.sub, boxShadow: running ? "0 0 8px #7dd88a" : "none" }} />
          <span style={{ fontSize: 11.5, color: T.sub, fontFamily: F_MONO, letterSpacing: ".03em" }}>LIVE LOG</span>
        </div>
        <div style={{ maxHeight: 180, overflowY: "auto", padding: "10px 13px", fontFamily: F_MONO, fontSize: 12, lineHeight: 1.75 }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.kind === "ok" ? "#7dd88a" : l.kind === "err" ? "#ff7a7a" : l.kind === "sys" ? T.gold : T.logInk }}>
              <span style={{ color: T.sub, marginRight: 8 }}>
                {new Date(l.t).toLocaleTimeString("ko-KR", { hour12: false })}
              </span>
              {l.msg}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

// 세그먼트 선택 (유형/게이트웨이)
function Seg({ label, value, opts, onPick, accent }: {
  label: string; value: string; opts: [string, string][]; onPick: (v: string) => void; accent: string;
}) {
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
              fontWeight: 700, fontSize: 12.5, transition: "all .15s",
            }}>{lbl}</button>
          );
        })}
      </div>
    </div>
  );
}
