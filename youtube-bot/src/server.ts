import express from "express";
import cors from "cors";
import { seedView, ProxyConfig } from "./youtube";

// ─────────────────────────────────────────────────────────────
//  youtube-bot 서버 — 골든시드 유튜브 시딩 (insta-bot 서버 패턴 재활용)
//  STEP1 = 조회 시딩 엔드포인트. 좋아요/댓글/팔로우는 STEP2+.
//  DB 로깅(gs_seed_logs)은 Supabase REST 붙으면 붙임(현재 TODO).
// ─────────────────────────────────────────────────────────────

const app = express();
const PORT = Number(process.env.GS_BOT_PORT) || 3366;
const AUTH_TOKEN = process.env.BOT_AUTH_TOKEN || "";

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173", "null"] }));
app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  if (req.get("Authorization") === `Bearer ${AUTH_TOKEN}`) return next();
  res.status(401).json({ error: "Unauthorized" });
});

/* ── 헬스체크 ── */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "0.1.0", service: "youtube-bot" });
});

/* ── SSE 헬퍼 ── */
function sseSetup(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}
function sseSend(res: express.Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/* ── 작업 중단 신호 ── */
const stopMap = new Map<string, boolean>();
app.post("/api/stop/:jobId", (req, res) => {
  stopMap.set(req.params.jobId, true);
  res.json({ ok: true });
});

/* ── 조회 시딩 (SSE) — STEP1 ──
   쿼리: videoUrl, videoType(shorts|longform), gateway(instagram|facebook|direct),
        watchSeconds?, proxyServer?, proxyUser?, proxyPass?, jobId? */
app.get("/api/seed/view", async (req, res) => {
  const {
    videoUrl, videoType, gateway, watchSeconds,
    proxyServer, proxyUser, proxyPass, jobId,
  } = req.query as Record<string, string>;

  if (!videoUrl) return res.status(400).json({ error: "videoUrl 필요" });

  sseSetup(res);
  const jid = jobId || Date.now().toString();
  stopMap.set(jid, false);

  try {
    const proxy: ProxyConfig | undefined = proxyServer
      ? { server: proxyServer, username: proxyUser, password: proxyPass }
      : undefined;

    const r = await seedView({
      videoUrl,
      videoType: videoType === "longform" ? "longform" : "shorts",
      gateway: (gateway as "instagram" | "facebook" | "direct") || "instagram",
      proxy,
      watchSeconds: watchSeconds ? parseInt(watchSeconds, 10) : undefined,
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      stopSignal: () => stopMap.get(jid) === true,
    });

    sseSend(res, { type: "seed_done", ...r });
    // TODO(Supabase REST 붙으면): gs_seed_logs insert
    //   { campaign_id, account_id:null, action:'view', status:r.status,
    //     gateway, watch_seconds:r.watchedSeconds }
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  stopMap.delete(jid);
  res.end();
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[youtube-bot] 서버 시작 → http://localhost:${PORT}`);
});

export default app;
