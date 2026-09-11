import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";

/* ───────────────────────────────────────────────────────────
   🌱 골든시드 회원 주문 화면 (OrderHome) — 트래픽 계승.
   유튜브/인스타 각각 + 액션(조회·시청·좋아요·댓글·구독·공유 등)을 하나하나 체크해 주문.
   submit_tool_request(payload) → 관리자 승인 → 승인된 tool·action 만 시딩 콘솔에서 켜짐.
─────────────────────────────────────────────────────────── */

type ToolKey = "youtube" | "instagram";
// [id, 라벨, 로그인필요여부(계정 필요)]
const TOOLS: { key: ToolKey; label: string; desc: string; actions: [string, string, boolean][] }[] = [
  {
    key: "youtube", label: "▶️ 유튜브 시딩", desc: "골든아워(첫 30분)에 조회·시청·참여를 꽂아 노출 임계선을 넘겨요.",
    actions: [["view", "조회수", false], ["watch", "시청수", false], ["like", "좋아요", true], ["comment", "댓글", true], ["subscribe", "구독", true], ["share", "공유", false]],
  },
  {
    key: "instagram", label: "📸 인스타 시딩", desc: "게시물·릴스에 초기 참여를 꽂아 탐색·릴스 노출을 키워요.",
    actions: [["view", "조회수", false], ["like", "좋아요", true], ["comment", "댓글", true], ["follow", "팔로우", true], ["share", "공유", false], ["repost", "리포스트", true], ["save", "저장", true]],
  },
];
const PLANS: [string, string][] = [["basic", "베이직"], ["pro", "프로"], ["premium", "프리미엄"], ["unlimited", "무제한"]];
const PERIODS: [number, string][] = [[7, "7일"], [30, "30일"], [90, "90일"], [365, "1년"]];

export default function OrderHome({ token, theme, memberName, approvedTools, onGoConsole }: {
  token: string; theme: "dark" | "light"; memberName?: string; approvedTools: string[]; onGoConsole: () => void;
}) {
  const dark = theme === "dark";
  const C = useMemo(() => dark
    ? { bg: "#08070b", panel: "#131019", panel2: "#1b1725", ink: "#f4efe4", sub: "#9a9284", line: "#2a2436", line2: "#3a3253", accent: "#f5c451", accent2: "#c9a03f", glow: "rgba(245,196,81,.12)", good: "#7dd88a", warn: "#f5c451", danger: "#ff7a7a" }
    : { bg: "#faf5ea", panel: "#fffdf7", panel2: "#f6efdf", ink: "#2a2010", sub: "#8a7a52", line: "#e8dcc0", line2: "#dcc99a", accent: "#b8860b", accent2: "#9a6f14", glow: "rgba(184,134,11,.10)", good: "#059669", warn: "#b8860b", danger: "#dc2626" }, [dark]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [acts, setActs] = useState<Record<string, Set<string>>>({ youtube: new Set(), instagram: new Set() });
  const [plan, setPlan] = useState<Record<string, string>>({ youtube: "basic", instagram: "basic" });
  const [days, setDays] = useState<Record<string, number>>({ youtube: 30, instagram: 30 });
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [myReq, setMyReq] = useState<{ status: string; payload: any[]; created_at: string } | null>(null);

  const loadMyReq = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("my_tool_request", { p_token: token });
      const r = (data && data[0]) || null;
      setMyReq(r ? { status: r.status, payload: Array.isArray(r.payload) ? r.payload : [], created_at: r.created_at } : null);
    } catch { /* 신청 없음 */ }
  }, [token]);
  useEffect(() => { void loadMyReq(); const iv = window.setInterval(loadMyReq, 5000); return () => window.clearInterval(iv); }, [loadMyReq]);

  const toggleTool = (k: string) => setSelected(s => ({ ...s, [k]: !s[k] }));
  const toggleAct = (tool: string, key: string) => setActs(m => { const n = new Set(m[tool]); n.has(key) ? n.delete(key) : n.add(key); return { ...m, [tool]: n }; });

  const chosen = TOOLS.filter(t => selected[t.key]);
  const submit = useCallback(async () => {
    if (!chosen.length) { setMsg("주문할 플랫폼을 1개 이상 선택하세요"); setTimeout(() => setMsg(""), 3000); return; }
    for (const t of chosen) {
      if (!(acts[t.key] && acts[t.key].size)) { setMsg(`${t.label}의 액션을 1개 이상 선택하세요`); setTimeout(() => setMsg(""), 3000); return; }
    }
    const payload = chosen.map(t => ({ tool: t.key, actions: Array.from(acts[t.key] || []), plan: plan[t.key] || "basic", days: days[t.key] || 30 }));
    setSending(true);
    const { error } = await supabase.rpc("submit_tool_request", { p_token: token, p_payload: payload });
    setSending(false);
    if (error) { setMsg("주문 실패: " + error.message); return; }
    setMsg("✅ 주문 완료 — 관리자 승인을 기다려 주세요"); setSelected({}); void loadMyReq(); setTimeout(() => setMsg(""), 5000);
  }, [chosen, acts, plan, days, token, loadMyReq]);

  const btn = (bg: string, fg: string, bd?: string): React.CSSProperties => ({ padding: "8px 14px", borderRadius: 9, border: bd ? `1.5px solid ${bd}` : "none", background: bg, color: fg, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" });
  const statusPill = (st: string) => st === "approved" ? { t: "승인됨 ✅", c: C.good } : st === "rejected" ? { t: "거절됨", c: C.danger } : { t: "승인 대기 중 ⏳", c: C.warn };

  return (
    <div style={{ fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif", color: C.ink, maxWidth: 860, margin: "0 auto", padding: "18px 20px 24px" }}>
      {/* 프로그램 설명 */}
      <div style={{ background: `linear-gradient(135deg,${C.glow},transparent)`, border: `1px solid ${C.line2}`, borderRadius: 16, padding: "20px 22px", marginBottom: 16 }}>
        <div style={{ fontSize: 19, fontWeight: 900, marginBottom: 6 }}>{memberName ? `${memberName}님, ` : ""}필요한 시딩을 골라 주문하세요</div>
        <div style={{ fontSize: 13, color: C.sub, fontWeight: 600, lineHeight: 1.7 }}>
          골든시드는 <b style={{ color: C.accent }}>유튜브·인스타</b>의 골든아워(첫 30분)에 <b style={{ color: C.accent }}>조회·좋아요·댓글</b>을 정확한 양으로 꽂아 노출 임계선을 넘겨주는 시딩 엔진이에요.<br />
          아래에서 <b style={{ color: C.ink }}>원하는 플랫폼과 액션만 골라</b> 등급·기간을 정해 <b style={{ color: C.ink }}>주문</b>하면, 관리자 승인 후 바로 쓸 수 있어요. (결제 안내는 승인 과정에서 따로 드려요)
        </div>
      </div>

      {/* 이미 승인된 게 있으면 시딩 콘솔로 */}
      {approvedTools.length > 0 && (
        <button onClick={onGoConsole} style={{ ...btn(`linear-gradient(135deg,${C.accent},${C.accent2})`, "#231a08"), width: "100%", padding: "14px", fontSize: 15, marginBottom: 16, borderRadius: 12 }}>
          ▶ 시딩 콘솔로 가기 (승인된 시딩 {approvedTools.length}개 사용)
        </button>
      )}

      {/* 내 주문 상태 */}
      {myReq && (
        <div style={{ background: C.panel, border: `1px solid ${C.line2}`, borderRadius: 12, padding: "12px 15px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>내 주문</span>
          <span style={{ fontSize: 12.5, fontWeight: 900, color: statusPill(myReq.status).c }}>{statusPill(myReq.status).t}</span>
          <span style={{ fontSize: 11.5, color: C.sub, fontWeight: 600 }}>
            {myReq.payload.map((p: any) => (TOOLS.find(t => t.key === p.tool)?.label || p.tool)).join(" · ")}
          </span>
        </div>
      )}

      {/* 플랫폼 주문 카드 */}
      {TOOLS.map(t => {
        const on = !!selected[t.key];
        const free = t.actions.filter(a => !a[2]);
        const login = t.actions.filter(a => a[2]);
        return (
          <div key={t.key} style={{ background: on ? C.panel2 : C.panel, border: `2px solid ${on ? C.accent : C.line}`, borderRadius: 14, padding: "16px 18px", marginBottom: 12, transition: "border-color .15s" }}>
            <div onClick={() => toggleTool(t.key)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${on ? C.accent : C.line2}`, background: on ? C.accent : "transparent", color: "#231a08", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, flexShrink: 0 }}>{on ? "✓" : ""}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15.5, fontWeight: 900 }}>{t.label}</div>
                <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, marginTop: 2 }}>{t.desc}</div>
              </div>
            </div>

            {on && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line2}`, display: "flex", flexDirection: "column", gap: 14 }}>
                {/* 액션 각각 체크 */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 7 }}>원하는 액션 선택 (각각)</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.good, marginBottom: 5 }}>계정 없이 가능</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
                    {free.map(([k, lb]) => {
                      const sel = acts[t.key]?.has(k);
                      return <button key={k} onClick={() => toggleAct(t.key, k)} style={btn(sel ? C.accent : C.panel, sel ? "#231a08" : C.sub, sel ? C.accent : C.line2)}>{sel ? "✓ " : ""}{lb}</button>;
                    })}
                  </div>
                  {login.length > 0 && <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.warn, marginBottom: 5 }}>🔑 계정 필요 (승인 후 계정풀 연결)</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {login.map(([k, lb]) => {
                        const sel = acts[t.key]?.has(k);
                        return <button key={k} onClick={() => toggleAct(t.key, k)} style={btn(sel ? C.accent : C.panel, sel ? "#231a08" : C.sub, sel ? C.accent : C.line2)}>{sel ? "✓ " : ""}{lb}</button>;
                      })}
                    </div>
                  </>}
                </div>

                {/* 등급 */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 7 }}>등급</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {PLANS.map(([k, lb]) => {
                      const sel = plan[t.key] === k;
                      return <button key={k} onClick={() => setPlan(m => ({ ...m, [t.key]: k }))} style={btn(sel ? C.accent : C.panel, sel ? "#231a08" : C.sub, sel ? C.accent : C.line2)}>{sel ? "✓ " : ""}{lb}</button>;
                    })}
                  </div>
                </div>

                {/* 기간 */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 7 }}>기간</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {PERIODS.map(([d, lb]) => {
                      const sel = days[t.key] === d;
                      return <button key={d} onClick={() => setDays(m => ({ ...m, [t.key]: d }))} style={btn(sel ? C.accent : C.panel, sel ? "#231a08" : C.sub, sel ? C.accent : C.line2)}>{sel ? "✓ " : ""}{lb}</button>;
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* 주문하기 */}
      <div style={{ position: "sticky", bottom: 0, paddingTop: 8, paddingBottom: 8, background: `linear-gradient(0deg,${C.bg} 70%,transparent)` }}>
        {msg && <div style={{ fontSize: 13, fontWeight: 800, color: msg.startsWith("✅") ? C.good : C.danger, marginBottom: 8, textAlign: "center" }}>{msg}</div>}
        <button onClick={submit} disabled={sending || !chosen.length} style={{ ...btn(chosen.length ? `linear-gradient(135deg,${C.accent},${C.accent2})` : C.panel, chosen.length ? "#231a08" : C.sub), width: "100%", padding: "15px", fontSize: 15.5, borderRadius: 12, cursor: chosen.length ? "pointer" : "default", opacity: sending ? 0.6 : 1 }}>
          {sending ? "주문 전송 중…" : `🌱 주문하기${chosen.length ? ` (${chosen.length}개 플랫폼)` : ""}`}
        </button>
      </div>
    </div>
  );
}
