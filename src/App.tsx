import React, { useState, useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import GoldenSeedApp from "./GoldenSeedApp";
import { PublyUser, refreshUserById, touchLastSeen, logoutServerSession, verifyAdminSession, clearAdminSession, getMemberSessionToken, isThisDeviceActive } from "./lib/supabase";

type View = "login" | "admin-login" | "admin" | "dashboard";

declare global {
  interface Window {
    electron?: {
      getBotStatus: () => Promise<string>;
      getBotSecret: () => Promise<string>;
      registerUser: (userId: string) => Promise<boolean>;
      unregisterUser: (userId: string) => Promise<boolean>;
      openPreview: (html: string) => Promise<void>;
      saveReportPdf: (html: string, filename: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
      flowLaunchChrome: () => Promise<{ ok: boolean; already?: boolean; launched?: boolean; error?: string }>;
      flowStatus: () => Promise<{ ready: boolean }>;
      checkAppUpdate: () => Promise<{ available: boolean; currentVersion?: string; latestVersion?: string; url?: string }>;
      openAppUpdate: (url: string) => Promise<boolean>;
      openLogFolder: () => Promise<boolean>;
      readBotLog: () => Promise<string>;
      getAppVersion: () => Promise<string>;
      keepAwake: (on: boolean) => Promise<{ ok: boolean; active?: boolean; error?: string }>;
    };
  }
}

// 앱 내 업데이트 배너 제거 — 다운로드는 웹사이트(publy.blogautopro.com)에서만.

export default function App() {
  const [view, setView]   = useState<View>("login");
  const [adminFrameKey, setAdminFrameKey] = useState<number>(Date.now());   // 관리자 iframe 캐시버스터
  const [user, setUser]   = useState<PublyUser | null>(null);
  const [theme, setTheme] = useState<"dark"|"light">(() =>
    (localStorage.getItem("publy_theme") as any) || "light"  // 최초 실행은 라이트 고정(로그인·회원대시보드)
  );
  // 저장된 로그인이 있으면 그 캐시로 즉시 대시보드 시작(네트워크 안 기다림), 없으면 즉시 로그인 화면.
  //   → 앱 켤 때 로딩 지연(Supabase 응답 대기) 제거. 세션 검증은 백그라운드로.
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const saved = localStorage.getItem("publy_user");
    if (saved) {
      // 캐시된 로그인으로 바로 대시보드 → 뒤에서 서버 검증해 어긋나면 로그아웃
      try {
        const cached = JSON.parse(saved) as PublyUser;
        setUser(cached); setView("dashboard");
        window.electron?.registerUser(cached.id);
        (async () => {
          try {
            const hasServerSession = !!getMemberSessionToken();
            const fresh = await refreshUserById(cached.id);
            const next = fresh || (hasServerSession ? null : cached);
            if (!alive) return;
            if (next) { setUser(next); localStorage.setItem("publy_user", JSON.stringify(next)); }
            else { localStorage.removeItem("publy_user"); setUser(null); setView("login"); }
          } catch {}
        })();
      } catch { localStorage.removeItem("publy_user"); }
    }
    // 관리자 세션 복원(백그라운드) — 로그인 화면 표시를 막지 않음
    (async () => { try { if (await verifyAdminSession()) { if (alive) setView("admin"); } else sessionStorage.removeItem("publy_admin_auth"); } catch {} })();
    return () => { alive = false; };
  }, []);

  // ★회원 등급/활성 실시간 반영(테리 요청): 관리자가 등급을 바꾸면(무제한 등) 회원 앱이
  //   로그아웃 없이도 최신 등급을 반영한다. ①로그인 상태면 즉시 1회 최신화 ②20초마다 갱신.
  //   등급이 실제로 바뀐 경우에만 setUser(리렌더 최소화). localStorage도 함께 갱신해 새로고침에도 유지.
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const sync = async () => {
      try {
        void touchLastSeen(user.id);   // 마지막 접속 시각 갱신(관리자 확인용)
        const fresh = await refreshUserById(user.id);
        if (!alive) return;
        if (!fresh) { if (getMemberSessionToken()) handleLogout(); return; }
        // 비활성 처리되면 로그아웃
        if ((fresh as any).is_active === false) { handleLogout(); return; }
        // 🔒 다른 컴퓨터에서 로그인되면 이 기기는 자동 로그아웃(관리자·멀티허용 회원 제외)
        const deviceOk = await isThisDeviceActive(user.id, (fresh as any).email || (user as any).email);
        if (!alive) return;
        if (!deviceOk) { alert("다른 컴퓨터에서 로그인되어 이 기기는 로그아웃됩니다."); handleLogout(); return; }
        // ★관리자가 바꾼 회원 값(등급·활성·크롤링 권한 등)이 회원 앱에 반영되게 — crawl_enabled도 확인해야 잠금해제가 실제로 풀린다.
        //   (예전엔 plan/is_active만 봐서, 관리자가 크롤링 풀어줘도 회원 앱은 캐시된 잠김 상태 그대로였음)
        const changed = fresh.plan !== user.plan
          || (fresh as any).is_active !== (user as any).is_active
          || (fresh as any).crawl_enabled !== (user as any).crawl_enabled;
        if (changed) {
          localStorage.setItem("publy_user", JSON.stringify(fresh));
          setUser(fresh);
        }
      } catch {}
    };
    void sync();
    const iv = window.setInterval(sync, 20000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [user?.id, user?.plan]);

  useEffect(() => { localStorage.setItem("publy_theme", theme); }, [theme]);

  // 관리자 iframe(admin/index.html) 헤더 버튼 → postMessage 수신: 회원화면 이동 / iframe 최신반영
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || d.type !== "gs-admin-nav") return;
      if (d.action === "dashboard") setView("dashboard");
      else if (d.action === "reload") setAdminFrameKey(Date.now());
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  function toggleTheme() { setTheme(t => t === "dark" ? "light" : "dark"); }

  function handleLogin(u: PublyUser) {
    // ★같은 PC에서 '다른 회원'이 로그인하면 이전 회원의 개인 작업 흔적을 싹 비운다(캐시 잔재로 남 데이터 보이는 버그 방지).
    //   지우는 대상 = 키워드·제목·원터치 로그/설정·예약·인사말·링크 등 '작업 데이터'. (계정 연결/API키 등 기기 공용 설정은 유지)
    try {
      const lastUid = localStorage.getItem("publy_last_uid") || "";
      if (lastUid && lastUid !== u.id) {
        const prefixes = ["publy_kws","publy_titles","publy_ot_","publy_greeting","publy_onpartner","publy_mylinks","publy_republish","publy_sa_","publy_calendar","publy_content_calendar"];
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && prefixes.some(p => k.startsWith(p))) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
      }
      localStorage.setItem("publy_last_uid", u.id);
    } catch {}
    localStorage.setItem("publy_user", JSON.stringify(u));
    setUser(u);
    setView("dashboard");
    // 로그인 시 봇 서버에 유저 등록 → Supabase 폴링 시작
    window.electron?.registerUser(u.id);
  }

  function handleLogout() {
    if (user?.id) void window.electron?.unregisterUser(user.id);
    void logoutServerSession();
    localStorage.removeItem("publy_user");
    setUser(null);
    setView("login");
  }

  function handleAdminAuth() {
    sessionStorage.setItem("publy_admin_auth", "true");
    setView("admin");
  }

  function handleAdminLogout() {
    sessionStorage.removeItem("publy_admin_auth");
    clearAdminSession();
    setView("login");
  }

  if (loading) return (
    <div style={{
      width:"100vw", height:"100vh",
      background: theme==="dark" ? "#0d0a14" : "#f1eef9",
      display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{
        width:44, height:44, borderRadius:"50%",
        border:"3px solid rgba(109,40,217,.2)",
        borderTopColor:"#6d28d9",
        animation:"spin 1s linear infinite",
      }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // 트래픽 앱 — 퍼블리 인트로 영상 제거(첫 화면부터 트래픽 로그인). showIntro 미사용.

  if (view==="login") return (
    <LoginPage
      onLogin={handleLogin}
      onAdminLogin={() => setView("admin-login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  // 🌱 로고 7번 탭 → 골든시드 관리자(public/admin/index.html)를 그대로 띄운다.
  //   골든시드 관리자 자체가 로그인+대시보드(주문승인·회원관리·발급·계정농사 컨트롤타워)를 다 가짐.
  //   ★경로: dev(http)는 절대경로 `/admin/index.html`(vite dev server가 서빙), 설치본(file://)은
  //     상대경로 `admin/index.html`. file://에서 `/admin/...`는 파일시스템 루트로 풀려 404=백지가 됨.
  const adminSrc = `${typeof location!=="undefined" && location.protocol==="file:" ? "" : "/"}admin/index.html?t=${adminFrameKey}`;
  //   ★회원화면/최신반영 버튼은 관리자 헤더("골든시드 관리자" 글자 옆) 안에 있고(admin/index.html),
  //     클릭 시 postMessage로 여기에 신호를 보낸다(아래 useEffect 리스너). iframe 위에 오버레이로 얹지 않음
  //     (얹으면 관리자 우측 테마버튼을 가림 — 테리 지적).
  if (view==="admin-login" || view==="admin") return (
    <div style={{ width:"100vw", height:"100vh" }}>
      {/* 캐시버스터(?t)+key — key를 바꿔 iframe을 아예 새로 마운트(src만 바꾸면 리로드 안 돼 옛 화면 남음) */}
      <iframe key={adminFrameKey} id="gs-admin-frame" src={adminSrc} title="골든시드 관리자" style={{ width:"100%", height:"100%", border:"none" }} />
    </div>
  );

  // 🌱 골든시드 = 로그인 후 시딩 콘솔 셸(GoldenSeedApp)만 렌더.
  //   (DashboardPage는 코드로만 남겨두고 사용 안 함 — import 유지로 타입 안전)
  if (view==="dashboard" && user) return (
    <GoldenSeedApp
      user={user}
      onLogout={handleLogout}
      onAdminLogin={() => setView("admin-login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  return null;
}
