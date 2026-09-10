import React, { useState, useEffect, useCallback, useRef } from "react";
import { PublyUser } from "./lib/supabase";
import { botFetch } from "./lib/botApi";
import SeedingCenter from "./components/SeedingCenter";

/* ───────────────────────────────────────────────────────────
   🌱 GoldenSeedApp — 골든시드 로그인 후 메인 셸.
   트래픽(TrafficApp)의 컴팩트 셸 구조를 계승하되, 네이버 전용부
   (OrderHome·InflowCenter·네이버 계정연결·대여 카운트다운)는 제거하고
   본문을 시딩 콘솔(SeedingCenter)로 교체했다.
   디자인 = 다크 럭셔리 + 골드(인플루언서 감성, SeedingCenter와 통일).
─────────────────────────────────────────────────────────── */

const YT_BOT = "http://localhost:3366";

// SeedingCenter와 동일 팔레트(다크 골드) — 헤더/셸.
const T = {
  bg: "#08070b",
  head: "linear-gradient(180deg,rgba(245,196,81,.08),transparent)",
  panel: "#131019",
  line: "#2a2436",
  ink: "#f4efe4",
  sub: "#9a9284",
  gold: "#f5c451",
  goldDim: "#c9a03f",
  goldGlow: "rgba(245,196,81,.18)",
};
const F_DISPLAY = "'Sora', ui-sans-serif, system-ui, sans-serif";

type Props = { user: PublyUser; onLogout: () => void; onAdminLogin: () => void; theme: "light" | "dark"; onThemeToggle: () => void };

export default function GoldenSeedApp({ user, onLogout, onAdminLogin }: Props) {
  // ── 🌱 봇(youtube-bot 3366) 온라인 감지 — health는 봇 인증 뒤에 있어 botFetch(토큰) 사용 ──
  const [botOnline, setBotOnline] = useState(false);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try { const r = await botFetch(`${YT_BOT}/health`, { signal: AbortSignal.timeout(3000) }); if (alive) setBotOnline(r.ok); }
      catch { if (alive) setBotOnline(false); }
    };
    void ping();
    const iv = window.setInterval(ping, 4000);
    return () => { alive = false; window.clearInterval(iv); };
  }, []);

  // ── 앱 버전 ──
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => { window.electron?.getAppVersion?.().then((v: string) => setAppVersion(v)).catch(() => {}); }, []);

  // ── 🍞 토스트(트래픽 계승) ──
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const showToast = useCallback((msg: string, type: "success" | "error" | "info" = "success") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3200);
  }, []);

  // ── 로고 5회 탭 → 관리자 로그인(숨김 진입, 트래픽 계승) ──
  const logoTap = useRef(0);
  const logoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLogoTap = () => {
    logoTap.current += 1;
    if (logoTimer.current) clearTimeout(logoTimer.current);
    if (logoTap.current >= 5) { logoTap.current = 0; onAdminLogin(); return; }
    logoTimer.current = setTimeout(() => { logoTap.current = 0; }, 1400);
  };

  const btn = (bg: string, color: string): React.CSSProperties => ({ padding: "7px 14px", borderRadius: 9, border: `1px solid ${T.line}`, background: bg, color, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.bg, color: T.ink, fontFamily: "'Pretendard',-apple-system,system-ui,sans-serif", overflow: "hidden" }}>
      <style>{`@keyframes pulseGold{0%{box-shadow:0 0 0 0 rgba(245,196,81,.7)}70%{box-shadow:0 0 0 6px rgba(245,196,81,0)}100%{box-shadow:0 0 0 0 rgba(245,196,81,0)}}`}</style>
      {/* 상단 골드 스트립 */}
      <div style={{ height: 3, flexShrink: 0, background: `linear-gradient(90deg,${T.gold},${T.goldDim} 60%,#8a6d28)` }} />

      {/* 헤더 — 드래그로 창 이동(맥 hiddenInset). 좌측 78px=신호등 자리. 버튼·로고는 no-drag */}
      <div style={{ height: 48, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 12px 0 78px", borderBottom: `1px solid ${T.line}`, background: T.head, ["WebkitAppRegion" as any]: "drag" }}>
        <div onClick={onLogoTap} style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(135deg,${T.gold},${T.goldDim})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: `0 4px 14px ${T.goldGlow}`, cursor: "pointer", userSelect: "none", ["WebkitAppRegion" as any]: "no-drag" }}>🌱</div>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".01em", fontFamily: F_DISPLAY }}>GoldenSeed <small style={{ color: T.sub, fontWeight: 600, marginLeft: 5, fontSize: 11 }}>· 시딩 엔진{appVersion ? ` v${appVersion}` : ""}</small></div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: "rgba(255,255,255,.03)", border: `1px solid ${T.line}`, fontSize: 10.5, fontWeight: 800, color: botOnline ? T.gold : T.sub }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: botOnline ? T.gold : "#dc2626", animation: botOnline ? "pulseGold 1.4s infinite" : "none" }} />{botOnline ? "봇 온라인" : "봇 오프라인"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", ["WebkitAppRegion" as any]: "no-drag" }}>
          <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 700 }}>{user.name || user.email}</span>
          <button onClick={onLogout} style={btn(T.panel, T.sub)}>로그아웃</button>
        </div>
      </div>

      {/* 본문 = 시딩 콘솔. SeedingCenter가 자체적으로 봇 연동·상태·로그를 관리한다. */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <SeedingCenter showToast={showToast} />
      </div>

      {/* 토스트 */}
      <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.35)", background: t.type === "error" ? "#2e1a1a" : t.type === "info" ? "#1a1f2e" : "#1a2417", color: t.type === "error" ? "#f87171" : t.type === "info" ? "#93c5fd" : "#7dd88a", border: `1px solid ${t.type === "error" ? "rgba(248,113,113,.25)" : t.type === "info" ? "rgba(147,197,253,.25)" : "rgba(125,216,138,.25)"}` }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
