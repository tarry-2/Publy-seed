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

  // ── 📱 모바일 폭 감지(헤더 버튼이 좁은 화면에서 안 잘리게) ──
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 560);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 560);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── 🎫 라이선스(승인) 로드 — 승인된 tool·action 만 시딩 콘솔에서 켜짐 ──
  const [lics, setLics] = useState<ToolLicense[]>([]);
  const [licLoaded, setLicLoaded] = useState(false);
  const [licFetchedAt, setLicFetchedAt] = useState(0);   // 🎫 라이선스 로드 시각 — 만기 카운트다운 기준(서버 remain_sec - 경과초, 시계조작 방지)
  const [homeView, setHomeView] = useState(true);  // true=주문화면, false=시딩 콘솔
  const homeInitRef = useRef(false);               // 최초 로드 1회만 홈/대시보드 판단(트래픽 계승)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const l = await getTrafficLicenses(user.email);
      if (!alive) return;
      setLics(l); setLicLoaded(true); setLicFetchedAt(Date.now());
      // ★트래픽 계승: 최초 로드 1회만 판단 — 승인 있으면(만료 전) 대시보드 직행, 승인 0이면 주문화면 유지.
      //   이후엔 사용자가 상단 버튼으로 자유 전환(자동 강제전환 안 함).
      if (!homeInitRef.current) {
        homeInitRef.current = true;
        const active = l.filter(x => x.expire_at === null || (x.remain_sec ?? 0) > 0);
        if (active.length > 0) setHomeView(false);   // 기존 승인회원=바로 대시보드
      }
    };
    void load();
    const iv = window.setInterval(load, 2000);   // ★2초 실시간 — 관리자가 승인/등급수정/기능변경하면 2초 내 반영(트래픽 동일)
    return () => { alive = false; window.clearInterval(iv); };
  }, [user.email]);

  // 승인되어 살아있는(만료 안 된) 라이선스만
  const activeLics = lics.filter(l => l.expire_at === null || (l.remain_sec ?? 0) > 0);
  const approvedTools = activeLics.map(l => l.tool);
  // tool → 승인된 액션 배열 맵(SeedingCenter가 이걸로 켤 수 있는 액션 제한)
  const allowedByTool: Record<string, string[]> = {};
  // tool → 승인 등급 맵(SeedingCenter가 이걸로 물량 상한 적용)
  const planByTool: Record<string, string> = {};
  // tool → 남은 기간(초)·만기일 맵(각 탭 하단 만기 표시용, 탭마다 만료 다름)
  const remainByTool: Record<string, number> = {};
  const expireByTool: Record<string, string | null> = {};
  activeLics.forEach(l => {
    allowedByTool[l.tool] = Array.isArray(l.allowed_actions) ? l.allowed_actions : [];
    planByTool[l.tool] = l.plan || "basic";
    remainByTool[l.tool] = l.remain_sec ?? 0;
    expireByTool[l.tool] = l.expire_at;
  });

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
    if (logoTap.current >= 7) { logoTap.current = 0; onAdminLogin(); return; }
    logoTimer.current = setTimeout(() => { logoTap.current = 0; }, 1400);
  };

  const btn = (bg: string, color: string): React.CSSProperties => ({ padding: "7px 14px", borderRadius: 9, border: `1px solid ${T.line}`, background: bg, color, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.bg, color: T.ink, fontFamily: "'Pretendard',-apple-system,system-ui,sans-serif", overflow: "hidden" }}>
      <style>{`@keyframes pulseGold{0%{box-shadow:0 0 0 0 rgba(245,196,81,.7)}70%{box-shadow:0 0 0 6px rgba(245,196,81,0)}100%{box-shadow:0 0 0 0 rgba(245,196,81,0)}}`}</style>
      {/* 상단 골드 스트립 */}
      <div style={{ height: 3, flexShrink: 0, background: `linear-gradient(90deg,${T.gold},${T.goldDim} 60%,#8a6d28)` }} />

      {/* 헤더 — 드래그로 창 이동(맥 hiddenInset). 좌측=신호등 자리(앱=78px, 모바일웹=12px). 버튼·로고는 no-drag */}
      <div style={{ height: 48, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: isMobile ? "0 8px" : "0 12px 0 78px", borderBottom: `1px solid ${T.line}`, background: T.head, ["WebkitAppRegion" as any]: "drag" }}>
        {/* 로고 C — 인라인(이미지 경로 X, Electron file:// 에서도 안 깨짐) */}
        <div onClick={onLogoTap} style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#f9dd86,#f5c451 55%,#c9a03f)", boxShadow: `0 4px 12px ${T.goldGlow}`, cursor: "pointer", userSelect: "none", ["WebkitAppRegion" as any]: "no-drag" }}>
          <span style={{ fontFamily: "'Bebas Neue',Arial Black,sans-serif", fontSize: 22, fontWeight: 900, color: "#231a08", lineHeight: 1, marginTop: 1 }}>C</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".01em", fontFamily: F_DISPLAY, whiteSpace: "nowrap" }}>GoldenSeed{!isMobile && <small style={{ color: T.sub, fontWeight: 600, marginLeft: 5, fontSize: 11 }}>· 시딩 엔진{appVersion ? ` v${appVersion}` : ""}</small>}</div>
        {/* 봇 상태 배지 — 모바일에선 점만(글자 생략) */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: isMobile ? "5px" : "3px 9px", borderRadius: 99, background: "rgba(255,255,255,.03)", border: `1px solid ${T.line}`, fontSize: 10.5, fontWeight: 800, color: botOnline ? T.gold : T.sub, flexShrink: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: botOnline ? T.gold : "#dc2626", animation: botOnline ? "pulseGold 1.4s infinite" : "none" }} />{!isMobile && (botOnline ? "봇 온라인" : "봇 오프라인")}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexShrink: 0, ["WebkitAppRegion" as any]: "no-drag" }}>
          {!isMobile && <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 700 }}>{user.name || user.email}</span>}
          {/* 🔀 주문↔대시보드 토글 — 승인된 게 있을 때만(트래픽 계승) */}
          {approvedTools.length > 0 && (
            <button onClick={() => setHomeView(h => !h)} title={homeView ? "시딩 콘솔로" : "주문 화면으로"} style={{ ...btn(homeView ? T.gold : T.panel, homeView ? "#231a08" : T.gold), padding: isMobile ? "6px 10px" : "7px 13px", border: `1px solid ${T.gold}` }}>
              {homeView ? (isMobile ? "📊" : "📊 대시보드") : (isMobile ? "🏠" : "🏠 주문")}
            </button>
          )}
          <button onClick={onThemeToggle} title="라이트/다크" style={{ ...btn(T.panel, T.ink), padding: "6px 9px" }}>{dark ? "☀️" : "🌙"}</button>
          <button onClick={onLogout} style={{ ...btn(T.panel, T.sub), padding: isMobile ? "6px 9px" : "7px 14px" }}>{isMobile ? "↩" : "로그아웃"}</button>
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
            {/* 콘솔 상단 라벨(주문↔대시보드 전환은 헤더 버튼으로) */}
            <div style={{ padding: "10px 20px 0" }}>
              <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 700 }}>승인된 시딩: {approvedTools.map(t => t === "youtube" ? "유튜브" : "인스타").join(" · ")}</span>
            </div>
            <SeedingCenter showToast={showToast} theme={theme} userId={user.id} approvedTools={approvedTools} allowedByTool={allowedByTool} planByTool={planByTool} remainByTool={remainByTool} expireByTool={expireByTool} licFetchedAt={licFetchedAt} />
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
