// ─────────────────────────────────────────────────────────────
//  YouTube Data API v3 — 공개 데이터(구독자·조회수) 실시간 조회
//  ★ API 키 방식(회원 부담 0). 남의 채널도 조회 가능(공개 데이터).
//  ★ Data API는 브라우저 CORS 허용 → Electron 렌더러에서 직접 fetch.
//  ★ 키 제한은 "없음" 또는 IP 제한 전제(HTTP referrer 제한 걸면 file://에서 막힘).
//  ⚠️ 시청시간(watch time)·수익은 비공개 → 이 API로 못 읽음(OAuth+Analytics 필요).
// ─────────────────────────────────────────────────────────────
const BASE = "https://www.googleapis.com/youtube/v3";

export type YtChannelStats = {
  channelId: string; title?: string;
  subscribers?: number; totalViews?: number; videoCount?: number;
};

// 채널 통계 — channelId 우선, 없으면 @handle로 조회
export async function ytChannelStats(opts: { channelId?: string; handle?: string; key: string }): Promise<YtChannelStats> {
  const p = new URLSearchParams({ part: "statistics,snippet", key: opts.key });
  if (opts.channelId) p.set("id", opts.channelId);
  else if (opts.handle) p.set("forHandle", opts.handle.replace(/^@/, ""));
  else throw new Error("channelId 또는 handle 필요");
  const r = await fetch(`${BASE}/channels?${p.toString()}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error?.message || "YouTube API 오류");
  const it = j.items?.[0];
  if (!it) throw new Error("채널을 찾을 수 없어요(주소 확인)");
  return {
    channelId: it.id,
    title: it.snippet?.title,
    subscribers: Number(it.statistics?.subscriberCount) || undefined,
    totalViews: Number(it.statistics?.viewCount) || undefined,
    videoCount: Number(it.statistics?.videoCount) || undefined,
  };
}

// 영상별 정확 조회수 — id 최대 50개씩 batch(호출당 1 quota). 반환 map videoId→views
export async function ytVideoViews(ids: string[], key: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const p = new URLSearchParams({ part: "statistics", id: chunk.join(","), key });
    const r = await fetch(`${BASE}/videos?${p.toString()}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error?.message || "YouTube API 오류");
    for (const it of j.items || []) {
      const v = Number(it.statistics?.viewCount);
      if (!isNaN(v)) out[it.id] = v;
    }
  }
  return out;
}

// 연결 테스트 — 키 유효성 확인(구글 공식 채널 1개 조회, 1 quota)
export async function ytTestKey(key: string): Promise<{ ok: boolean; msg: string }> {
  if (!key.trim()) return { ok: false, msg: "키를 먼저 입력하세요" };
  try {
    const p = new URLSearchParams({ part: "id", id: "UC_x5XG1OV2P6uZZ5FSM9Ttw", key });
    const r = await fetch(`${BASE}/channels?${p.toString()}`);
    const j = await r.json();
    if (j.error) return { ok: false, msg: j.error?.message || "키 오류(제한 설정·사용설정 확인)" };
    if (!j.items?.length) return { ok: false, msg: "응답이 비었어요(키 권한 확인)" };
    return { ok: true, msg: "✅ 연결 성공 — 키가 정상 작동해요" };
  } catch (e: any) {
    return { ok: false, msg: `네트워크 오류: ${e.message || e}` };
  }
}
