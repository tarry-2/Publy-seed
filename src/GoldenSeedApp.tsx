import React, { useState, useEffect, useCallback, useRef } from "react";
import { PublyUser, getTrafficLicenses, getMemberSessionToken, ToolLicense } from "./lib/supabase";
import { botFetch } from "./lib/botApi";
import SeedingCenter from "./components/SeedingCenter";
import OrderHome from "./components/OrderHome";

/* ───────────────────────────────────────────────────────────
   🌱 GoldenSeedApp — 골든시드 로그인 후 메인 셸.
   본문 = 시딩 콘솔(SeedingCenter). 라이트/다크 둘 다(가독성 배합).
   디자인 = 다크 럭셔리 골드(인플루언서 감성) / 라이트 크림+딥골드.
─────────────────────────────────────────────────────────── */

const YT_BOT = "http://localhost:3366";

// 헤더/셸 팔레트 — 라이트/다크. 라이트는 골드가 흐려지지 않게 딥골드 사용.
function palette(dark: boolean) {
  return dark
    ? { bg: "#08070b", head: "linear-gradient(180deg,rgba(245,196,81,.08),transparent)", panel: "#131019", line: "#2a2436", ink: "#f4efe4", sub: "#9a9284", gold: "#f5c451", goldDim: "#c9a03f", goldGlow: "rgba(245,196,81,.18)" }
    : { bg: "#faf5ea", head: "linear-gradient(180deg,rgba(184,134,11,.10),transparent)", panel: "#fffdf7", line: "#e8dcc0", ink: "#2a2010", sub: "#8a7a52", gold: "#b8860b", goldDim: "#9a6f14", goldGlow: "rgba(184,134,11,.12)" };
}
const F_DISPLAY = "'Sora', ui-sans-serif, system-ui, sans-serif";

type Props = { user: PublyUser; onLogout: () => void; onAdminLogin: () => void; theme: "light" | "dark"; onThemeToggle: () => void };

export default function GoldenSeedApp({ user, onLogout, onAdminLogin, theme, onThemeToggle }: Props) {
  const dark = theme === "dark";
  const T = palette(dark);
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

  // ── 🎫 라이선스(승인) 로드 — 승인된 tool·action 만 시딩 콘솔에서 켜짐 ──
  const [lics, setLics] = useState<ToolLicense[]>([]);
  const [licLoaded, setLicLoaded] = useState(false);
  const [homeView, setHomeView] = useState(true);  // true=주문화면, false=시딩 콘솔
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const l = await getTrafficLicenses(user.email);
      if (!alive) return;
      setLics(l); setLicLoaded(true);
      // 승인이 하나라도 있으면 처음부터 콘솔을 볼 수 있게(단, 첫 로드시 승인 없으면 주문화면 유지)
    };
    void load();
    const iv = window.setInterval(load, 4000);   // 관리자가 승인/취소하면 4초 내 반영
    return () => { alive = false; window.clearInterval(iv); };
  }, [user.email]);

  // 승인되어 살아있는(만료 안 된) 라이선스만
  const activeLics = lics.filter(l => l.expire_at === null || (l.remain_sec ?? 0) > 0);
  const approvedTools = activeLics.map(l => l.tool);
  // tool → 승인된 액션 배열 맵(SeedingCenter가 이걸로 켤 수 있는 액션 제한)
  const allowedByTool: Record<string, string[]> = {};
  activeLics.forEach(l => { allowedByTool[l.tool] = Array.isArray(l.allowed_actions) ? l.allowed_actions : []; });

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
        {/* 로고 C — 인라인(이미지 경로 X, Electron file:// 에서도 안 깨짐) */}
        <div onClick={onLogoTap} style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#f9dd86,#f5c451 55%,#c9a03f)", boxShadow: `0 4px 12px ${T.goldGlow}`, cursor: "pointer", userSelect: "none", ["WebkitAppRegion" as any]: "no-drag" }}>
          <span style={{ fontFamily: "'Bebas Neue',Arial Black,sans-serif", fontSize: 22, fontWeight: 900, color: "#231a08", lineHeight: 1, marginTop: 1 }}>C</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".01em", fontFamily: F_DISPLAY }}>GoldenSeed <small style={{ color: T.sub, fontWeight: 600, marginLeft: 5, fontSize: 11 }}>· 시딩 엔진{appVersion ? ` v${appVersion}` : ""}</small></div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: "rgba(255,255,255,.03)", border: `1px solid ${T.line}`, fontSize: 10.5, fontWeight: 800, color: botOnline ? T.gold : T.sub }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: botOnline ? T.gold : "#dc2626", animation: botOnline ? "pulseGold 1.4s infinite" : "none" }} />{botOnline ? "봇 온라인" : "봇 오프라인"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", ["WebkitAppRegion" as any]: "no-drag" }}>
          <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 700 }}>{user.name || user.email}</span>
          <button onClick={onThemeToggle} title="라이트/다크" style={{ ...btn(T.panel, T.ink), padding: "6px 9px" }}>{dark ? "☀️" : "🌙"}</button>
          <button onClick={onLogout} style={btn(T.panel, T.sub)}>로그아웃</button>
        </div>
      </div>

      {/* 본문 — 승인 게이트: 승인 없으면 주문화면, 있으면 주문↔콘솔 전환 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!licLoaded ? (
          <div style={{ padding: 40, textAlign: "center", color: T.sub, fontSize: 13 }}>불러오는 중…</div>
        ) : (approvedTools.length === 0 || homeView) ? (
          <OrderHome
            token={getMemberSessionToken()}
            theme={theme}
            memberName={user.name}
            approvedTools={approvedTools}
            onGoConsole={() => setHomeView(false)}
          />
        ) : (
          <>
            {/* 콘솔 상단: 주문화면으로 돌아가기 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px 0" }}>
              <button onClick={() => setHomeView(true)} style={{ ...btn(T.panel, T.sub), padding: "6px 12px" }}>← 주문/신청 화면</button>
              <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 700 }}>승인된 시딩: {approvedTools.map(t => t === "youtube" ? "유튜브" : "인스타").join(" · ")}</span>
            </div>
            <SeedingCenter showToast={showToast} theme={theme} approvedTools={approvedTools} allowedByTool={allowedByTool} />
          </>
        )}
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
