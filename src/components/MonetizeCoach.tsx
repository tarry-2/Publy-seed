import { useState } from "react";

/* ───────────────────────────────────────────────────────────
   💰 수익화(YouTube 파트너 프로그램) 브리핑·가이드 — MonetizeCoach
   채널 불러온 데이터(구독자·쇼츠 조회수)로 YPP 자격을 자동 진단하고,
   어느 경로가 가까운지 + 골든시드 시딩으로 목표까지 얼마 남았는지 가이드한다.
   ★ 출처(2026 기준):
     - 완전 수익화(광고수익) = 구독자 1,000 + (최근12개월 공개 시청 4,000시간 OR 최근90일 공개 쇼츠 1,000만 조회)
     - 초기단계(팬후원) = 구독자 500 + 최근90일 공개 3업로드 + (3,000시간 OR 300만 쇼츠조회)
     - 2027-02-01부터 상향: 8,000시간 / 2,000만 쇼츠
   ★ 한계(정직): 시청시간(4,000h)은 유튜브 스튜디오 비공개 데이터 → 사용자가 입력.
     쇼츠 90일 조회는 RSS로 업로드 시각 확인된 영상만 정확 집계(스튜디오 확인 권장).
─────────────────────────────────────────────────────────── */

export type CoachVideo = { videoId: string; type: "shorts" | "longform"; views?: number; publishedAt?: number };

const F_DISPLAY = "'Sora', ui-sans-serif, system-ui, sans-serif";
const F_MONO = "'JetBrains Mono', ui-monospace, monospace";
const D90 = 90 * 24 * 3600 * 1000;
const kfmt = (n: number) => n.toLocaleString();

// 게이지 바 — 2색: 실측(진한색) + 시딩 예상(연한 점선, 그 위에 덧칠)
//  ★ 시딩분은 "예상"이라 실측과 명확히 구분(가짜 성취감 방지). 실제는 🔄새로고침으로 확정.
function Gauge({ label, cur, goal, unit, color, T, note, seeded = 0, live, apiConfirm }: {
  label: string; cur: number; goal: number; unit: string; color: string; T: any; note?: string; seeded?: number; live?: boolean; apiConfirm?: boolean;
}) {
  const total = cur + seeded;
  const realDone = cur >= goal;
  const estDone = total >= goal;
  const basePct = Math.min(100, goal > 0 ? Math.round((cur / goal) * 100) : 0);
  const seedPct = Math.min(100, goal > 0 ? Math.round((total / goal) * 100) : 0);
  return (
    <div style={{ background: T.panel2, border: `1px solid ${realDone ? "#7dd88a" : T.line}`, borderRadius: 12, padding: "11px 13px", marginBottom: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 7, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: T.ink }}>{label}
          {live && <span style={{ fontSize: 9, color: "#7dd88a", fontWeight: 800, marginLeft: 5 }}>● 실시간(API)</span>}
        </span>
        <span style={{ marginLeft: "auto", fontFamily: F_MONO, fontSize: 12.5, fontWeight: 800, color: realDone ? "#7dd88a" : color }}>
          {kfmt(cur)}{seeded > 0 && <span style={{ color: T.gold, fontWeight: 700 }}> +🌱{kfmt(seeded)}</span>}
          <span style={{ color: T.sub, fontWeight: 600 }}> / {kfmt(goal)}{unit}</span>
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color: realDone ? "#7dd88a" : estDone ? T.gold : T.sub }}>
          {realDone ? "✅ 달성" : estDone ? "🌱 예상달성" : `${basePct}%`}
        </span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 99, background: T.line, overflow: "hidden" }}>
        {seeded > 0 && (
          <div style={{ position: "absolute", inset: 0, width: `${seedPct}%`, borderRadius: 99, background: `repeating-linear-gradient(45deg, ${T.gold}, ${T.gold} 4px, transparent 4px, transparent 8px)`, opacity: 0.5, transition: "width .4s" }} />
        )}
        <div style={{ position: "absolute", inset: 0, height: "100%", width: `${basePct}%`, borderRadius: 99, background: realDone ? "#7dd88a" : color, transition: "width .4s" }} />
      </div>
      {note && <div style={{ fontSize: 9.5, color: T.sub, marginTop: 5, lineHeight: 1.4 }}>{note}</div>}
      {seeded > 0 && <div style={{ fontSize: 9.5, color: T.gold, marginTop: 4, lineHeight: 1.4 }}>🌱 골든시드 시딩 예상 +{kfmt(seeded)}{unit} · {apiConfirm ? "🔄새로고침하면 유튜브 실제 반영분으로 확정" : "시청시간은 유튜브 스튜디오 비공개 값이라 자동 확정 안 됨 — 스튜디오에서 확인 후 직접 입력"}</div>}
    </div>
  );
}

export default function MonetizeCoach({ videos, subscribers, T, perVideoViews = 300, seededShortsViews = 0, seededWatchHours = 0, live }: {
  videos: CoachVideo[]; subscribers?: number; T: any; perVideoViews?: number;
  seededShortsViews?: number; seededWatchHours?: number; live?: boolean;
}) {
  // 시청시간(비공개 → 사용자 입력, localStorage 보존)
  const [watchHours, setWatchHours] = useState<number>(() => {
    try { return Number(localStorage.getItem("gs_ypp_watch_hours") || "0") || 0; } catch { return 0; }
  });
  const saveWatch = (v: number) => { setWatchHours(v); try { localStorage.setItem("gs_ypp_watch_hours", String(v)); } catch {} };

  const now = Date.now();
  const subs = subscribers || 0;
  const shorts = videos.filter((v) => v.type === "shorts");
  // 최근 90일 쇼츠 조회 — 업로드 시각(RSS) 확인된 것만 정확 집계
  const known90 = shorts.filter((v) => v.publishedAt != null && now - v.publishedAt <= D90);
  const shorts90Views = known90.reduce((s, v) => s + (v.views || 0), 0);

  // 경로별 진행률
  const G = { subs2: 1000, subs1: 500, hours: 4000, sv: 10_000_000 };
  const subsOk = subs >= G.subs2;
  const svPct = Math.min(100, Math.round((shorts90Views / G.sv) * 100));
  const whPct = Math.min(100, Math.round((watchHours / G.hours) * 100));
  const shortsPathReady = subsOk && shorts90Views >= G.sv;
  const longPathReady = subsOk && watchHours >= G.hours;

  // 부족분 + 골든시드 시딩 환산(영상당 perVideoViews 조회)
  const svNeed = Math.max(0, G.sv - shorts90Views);
  const subsNeed = Math.max(0, G.subs2 - subs);
  const seedVideosNeeded = perVideoViews > 0 ? Math.ceil(svNeed / perVideoViews) : 0;

  // 추천 경로(더 가까운 쪽)
  const recommend = svPct >= whPct ? "shorts" : "long";

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.gold}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: T.gold, marginBottom: 4, fontFamily: F_DISPLAY, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        💰 수익화(YPP) 진단
        {(shortsPathReady || longPathReady) && <span style={{ fontSize: 11, color: "#7dd88a", fontWeight: 800 }}>— 🎉 수익화 자격 달성!</span>}
      </div>
      <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 12, lineHeight: 1.5 }}>
        완전 수익화 = <b style={{ color: T.ink }}>구독자 1,000명</b> + 아래 둘 중 하나:
        <b style={{ color: T.ink }}> 12개월 시청 4,000시간</b> 또는 <b style={{ color: T.ink }}>90일 쇼츠 1,000만 조회</b>.
      </div>

      {/* 1) 구독자 */}
      <Gauge label="👥 구독자" cur={subs} goal={G.subs2} unit="명" color={T.gold} T={T} live={live}
        note={subs < G.subs1 ? `초기단계(팬후원)는 500명부터 — ${kfmt(G.subs1 - subs)}명 남음` : subs < G.subs2 ? `완전 수익화까지 ${kfmt(subsNeed)}명 남음` : undefined} />

      {/* 2) 쇼츠 경로 — 시딩 예상 반영 */}
      <Gauge label="🎬 최근 90일 쇼츠 조회" cur={shorts90Views} goal={G.sv} unit="회" color={T.yt} T={T} live={live} seeded={seededShortsViews} apiConfirm
        note={`RSS로 업로드시각 확인된 쇼츠 ${known90.length}개 기준 집계 · 정확한 90일 합계는 유튜브 스튜디오에서 확인${svNeed > 0 ? ` · 부족 ${kfmt(svNeed)}회` : ""}`} />

      {/* 3) 롱폼 시청시간(입력) — 시딩 예상 반영 */}
      <Gauge label="▶️ 최근 12개월 시청시간" cur={watchHours} goal={G.hours} unit="시간" color="#6db3ff" T={T} seeded={Math.round(seededWatchHours * 10) / 10}
        note="시청시간은 유튜브 스튜디오에만 있는 비공개 값이라 직접 입력해요" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "-2px 0 12px", paddingLeft: 2 }}>
        <span style={{ fontSize: 10.5, color: T.sub }}>스튜디오 시청시간 입력:</span>
        <input type="number" min={0} value={watchHours || ""} onChange={(e) => saveWatch(Math.max(0, +e.target.value || 0))}
          placeholder="0"
          style={{ width: 110, padding: "6px 9px", borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5, fontFamily: F_MONO, outline: "none" }} />
        <span style={{ fontSize: 10.5, color: T.sub }}>시간</span>
      </div>

      {/* 종합 가이드 */}
      <div style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, padding: "12px 13px" }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: T.gold, marginBottom: 7 }}>🧭 골든시드 가이드</div>
        {shortsPathReady || longPathReady ? (
          <div style={{ fontSize: 11.5, color: T.ink, lineHeight: 1.6 }}>
            🎉 이미 <b>완전 수익화 자격</b>을 채웠어요. AdSense 연결·2단계 인증·정책 확인만 하면 신청 가능!
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: T.ink, lineHeight: 1.65 }}>
            {subsNeed > 0 && <div>• 구독자 <b style={{ color: T.gold }}>{kfmt(subsNeed)}명</b> 더 필요해요.</div>}
            {recommend === "shorts" ? (
              <>
                <div>• <b style={{ color: T.yt }}>쇼츠 조회 경로</b>가 더 가까워요(골든시드에 딱 맞는 경로 — 조회는 우리가 밀 수 있어요).</div>
                {svNeed > 0 && <div>• 부족 조회 <b style={{ color: T.gold }}>{kfmt(svNeed)}회</b> ≈ 골든아워 시딩 <b style={{ color: T.gold }}>{kfmt(seedVideosNeeded)}개 영상</b>분(영상당 {perVideoViews}회 기준).</div>}
                <div style={{ color: T.sub, fontSize: 10.5, marginTop: 3 }}>👉 위에서 쇼츠를 골라 <b style={{ color: T.ink }}>전체 시딩</b>으로 조회 velocity를 채우세요.</div>
              </>
            ) : (
              <>
                <div>• <b style={{ color: "#6db3ff" }}>롱폼 시청시간 경로</b>가 더 가까워요. 남은 <b style={{ color: T.gold }}>{kfmt(Math.max(0, G.hours - watchHours))}시간</b>.</div>
                <div style={{ color: T.sub, fontSize: 10.5, marginTop: 3 }}>👉 롱폼은 시청시간(watch time)이 핵심 — 골든시드 롱폼 시딩으로 체류를 쌓으세요.</div>
              </>
            )}
          </div>
        )}
        <div style={{ fontSize: 10, color: "#ff9e6b", marginTop: 9, lineHeight: 1.45, borderTop: `1px solid ${T.line}`, paddingTop: 8 }}>
          ⚠️ 2027-02-01부터 기준 상향: 시청 <b>8,000시간</b> / 쇼츠 <b>2,000만 조회</b>. 그 전에 채우는 게 유리해요.
        </div>
      </div>
    </div>
  );
}
