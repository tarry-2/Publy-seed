import { useState } from "react";
import { ytTestKey } from "../lib/youtubeApi";

/* ───────────────────────────────────────────────────────────
   🔑 유튜브 API 연결 박스 — 키 입력·저장 + 발급방법·사용방법·연결테스트
   버튼 안에 기능/안내를 다 넣음(펼침). 회원 부담 0(채널 주소만 입력).
─────────────────────────────────────────────────────────── */

const F_DISPLAY = "'Sora', ui-sans-serif, system-ui, sans-serif";
const F_MONO = "'JetBrains Mono', ui-monospace, monospace";

export default function YtApiKeyBox({ apiKey, onSave, T, showToast }: {
  apiKey: string; onSave: (key: string) => void; T: any; showToast?: (m: string, t?: any) => void;
}) {
  const [draft, setDraft] = useState(apiKey);
  const [panel, setPanel] = useState<"issue" | "usage" | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const connected = !!apiKey;

  const save = () => {
    const k = draft.trim();
    onSave(k);
    showToast?.(k ? "API 키를 저장했어요" : "API 키를 지웠어요", k ? "success" : "info");
  };
  const test = async () => {
    setTesting(true); setTestResult(null);
    const r = await ytTestKey(draft.trim() || apiKey);
    setTestResult(r); setTesting(false);
    showToast?.(r.msg, r.ok ? "success" : "error");
  };

  const btn = (label: string, onClick: () => void, active?: boolean) => (
    <button onClick={onClick} style={{
      padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit",
      border: `1px solid ${active ? T.gold : T.line}`, background: active ? T.goldGlow : T.panel2, color: active ? T.gold : T.ink, whiteSpace: "nowrap",
    }}>{label}</button>
  );

  return (
    <div style={{ background: T.panel, border: `1px solid ${connected ? "#7dd88a" : T.gold}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, fontFamily: F_DISPLAY, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: T.gold }}>🔑 유튜브 API 연결</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: connected ? "#7dd88a" : T.sub }}>
          {connected ? "● 연결됨 (구독자·조회수 실시간)" : "○ 미연결 (지금은 스크래핑 스냅샷)"}
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: T.sub, marginBottom: 10, lineHeight: 1.5 }}>
        구글 API 키를 넣으면 구독자·조회수를 <b style={{ color: T.ink }}>유튜브 실제값으로 정확히</b> 읽어와요(무료·회원 부담 0).
        키가 없어도 스크래핑으로 대략은 보여줘요.
      </div>

      {/* 키 입력 + 저장 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="YouTube Data API v3 키 붙여넣기"
          style={{ flex: 1, minWidth: 160, boxSizing: "border-box", padding: "11px 13px", borderRadius: 11, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 13, fontFamily: F_MONO, outline: "none" }} />
        <button onClick={save} style={{ flexShrink: 0, padding: "0 16px", borderRadius: 11, border: `1px solid ${T.gold}`, background: T.gold, color: "#1a1408", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>💾 저장</button>
      </div>

      {/* 기능/안내 버튼 — 누르면 펼쳐짐 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {btn("📖 발급 방법", () => setPanel(panel === "issue" ? null : "issue"), panel === "issue")}
        {btn("❓ 사용 방법", () => setPanel(panel === "usage" ? null : "usage"), panel === "usage")}
        {btn(testing ? "🔌 테스트 중…" : "🔌 연결 테스트", test)}
      </div>

      {/* 연결 테스트 결과 */}
      {testResult && (
        <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 10, fontSize: 11.5, fontWeight: 700, lineHeight: 1.4,
          background: testResult.ok ? "rgba(125,216,138,.12)" : "rgba(255,122,122,.12)", color: testResult.ok ? "#7dd88a" : "#ff7a7a", border: `1px solid ${testResult.ok ? "#7dd88a" : "#ff7a7a"}` }}>
          {testResult.msg}
        </div>
      )}

      {/* 📖 발급 방법 (버튼 안 기능) */}
      {panel === "issue" && (
        <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 12, background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11.5, color: T.ink, lineHeight: 1.75 }}>
          <div style={{ fontWeight: 800, color: T.gold, marginBottom: 6 }}>📖 API 키 발급 방법 (무료, 5분)</div>
          <div><b>1.</b> <b style={{ color: T.gold }}>console.cloud.google.com</b> 접속 → 구글 로그인</div>
          <div><b>2.</b> 상단 프로젝트 선택 → <b>새 프로젝트</b> 만들기(이름 아무거나) → 만들기</div>
          <div><b>3.</b> 상단 검색창에 <b>"YouTube Data API v3"</b> 검색 → 클릭 → <b style={{ color: T.gold }}>[사용]</b> 버튼</div>
          <div><b>4.</b> 왼쪽 메뉴 <b>"사용자 인증 정보"</b> → <b>[+ 사용자 인증 정보 만들기]</b> → <b>"API 키"</b></div>
          <div><b>5.</b> 생성된 키 <b>복사</b> → 위 칸에 붙여넣고 <b style={{ color: T.gold }}>💾 저장</b></div>
          <div style={{ color: T.sub, marginTop: 6, fontSize: 10.5, lineHeight: 1.5 }}>
            💡 키 제한 화면이 뜨면 <b>"애플리케이션 제한 = 없음"</b>으로 두세요(앱에서 써야 함).
            API 제한은 "YouTube Data API v3"만 허용하면 더 안전해요.
          </div>
        </div>
      )}

      {/* ❓ 사용 방법 (버튼 안 기능) */}
      {panel === "usage" && (
        <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 12, background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11.5, color: T.ink, lineHeight: 1.75 }}>
          <div style={{ fontWeight: 800, color: T.gold, marginBottom: 6 }}>❓ 사용 방법</div>
          <div>• 키를 저장하면 채널 <b>[영상 불러오기]</b>·<b>🔄새로고침</b> 할 때 구독자·조회수가 <b style={{ color: T.gold }}>유튜브 실제값</b>으로 정확히 들어와요.</div>
          <div>• <b>무료</b>예요. 하루 할당량 10,000(채널·영상 조회는 아주 저렴해서 넉넉함). 초과하면 다음날 리셋.</div>
          <div>• 키 1개로 <b>내 채널·남의 채널 모두</b> 조회 가능(공개 데이터).</div>
          <div style={{ color: "#ff9e6b", marginTop: 6, fontSize: 10.5, lineHeight: 1.5 }}>
            ⚠️ <b>시청시간(watch time)</b>은 이 키로 못 읽어요(유튜브 스튜디오 비공개). 그건 직접 입력하거나, 나중에 구글 로그인(OAuth) 연동이 필요해요.
          </div>
        </div>
      )}
    </div>
  );
}
