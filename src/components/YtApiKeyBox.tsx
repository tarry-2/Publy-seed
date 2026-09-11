import { useState } from "react";
import { ytTestKey } from "../lib/youtubeApi";
import g1 from "../assets/guide/g1.jpg";
import g2 from "../assets/guide/g2.jpg";
import g3 from "../assets/guide/g3.jpg";
import g4 from "../assets/guide/g4.jpg";

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

      {/* 📖 발급 방법 (버튼 안 기능) — 실제 화면 스크린샷 + 단계별 */}
      {panel === "issue" && (
        <div style={{ marginTop: 10, padding: "13px 15px", borderRadius: 12, background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11.5, color: T.ink, lineHeight: 1.65 }}>
          <div style={{ fontWeight: 800, color: T.gold, marginBottom: 3, fontSize: 12.5 }}>📖 API 키 발급 방법</div>
          <div style={{ color: T.sub, marginBottom: 10, fontSize: 10.5 }}>무료 · 신용카드 없이 · 약 5분. 화면 그대로 따라오세요.</div>

          <Step n="1" T={T} text={<>브라우저에서 <b style={{ color: T.gold }}>console.cloud.google.com</b> 접속 → 구글 로그인</>} />
          <Step n="2" T={T} img={g1} text={<>맨 위 <b>프로젝트 선택</b> 클릭 → <b style={{ color: T.gold }}>이미 프로젝트가 있으면 그걸 클릭</b>해서 그대로 쓰면 돼요(새로 안 만들어도 됨). 없으면 우측 <b>새 프로젝트</b> → 이름 아무거나 → 만들기</>} />
          <Step n="3" T={T} img={g2} text={<>맨 위 <b>검색창</b>에 <b>YouTube Data API v3</b> 입력 → 결과 클릭 → 파란 <b style={{ color: T.gold }}>[사용]</b> 버튼. 사진처럼 <b>"사용 설정됨"</b>이면 이미 켜진 거니 넘어가세요</>} />
          <Step n="4" T={T} img={g3} text={<>왼쪽 메뉴 <b>사용자 인증 정보</b> → 위쪽 <b>[+ 사용자 인증 정보 만들기]</b> → <b style={{ color: T.gold }}>API 키</b> 선택</>} />
          <Step n="5" T={T} img={g4} text={<><b style={{ color: "#ff7a7a" }}>⭐ 여기서 자주 막혀요:</b> "API 제한사항 선택"이 <b>필수</b>라 빨간 <b>"API를 선택해야 합니다"</b>가 뜨면 → 드롭다운(▼) 열어 <b style={{ color: T.gold }}>YouTube Data API v3</b>를 체크 → 확인</>} />
          <Step n="6" T={T} text={<>같은 화면에서 <b>애플리케이션 제한사항 = 없음</b> 선택 / <b>"서비스 계정 인증" 체크박스는 비워둠</b> → 맨 아래 파란 <b style={{ color: T.gold }}>[만들기]</b></>} />
          <Step n="7" T={T} text={<>뜨는 <b>키를 복사</b> → 위 칸에 붙여넣고 <b style={{ color: T.gold }}>💾 저장</b> → <b>[🔌 연결 테스트]</b>로 확인</>} />

          <div style={{ color: "#ff9e6b", marginTop: 8, fontSize: 10.5, lineHeight: 1.5, borderTop: `1px solid ${T.line}`, paddingTop: 8 }}>
            💡 중간에 <b>결제(카드) 등록</b> 창이 떠도 무시하세요 — 조회 기능은 무료 할당량 안에서 카드 없이 작동해요.
          </div>
        </div>
      )}

      {/* ❓ 사용 방법 (버튼 안 기능) — 아래 Step는 발급방법에서만 씀 */}
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

// 발급방법 단계 — 번호 + 설명 + (있으면) 실제 화면 스크린샷
function Step({ n, text, img, T }: { n: string; text: any; img?: string; T: any }) {
  return (
    <div style={{ marginBottom: img ? 11 : 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <span style={{ flexShrink: 0, width: 19, height: 19, borderRadius: 6, background: T.gold, color: "#1a1408", fontSize: 11, fontWeight: 900, display: "grid", placeItems: "center", marginTop: 1 }}>{n}</span>
        <span style={{ flex: 1 }}>{text}</span>
      </div>
      {img && <img src={img} alt="" style={{ width: "100%", marginTop: 7, borderRadius: 9, border: `1px solid ${T.line}`, display: "block" }} />}
    </div>
  );
}
