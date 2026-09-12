import { supabase } from "./supabase";

/* ───────────────────────────────────────────────────────────
   골든시드 프록시 — 트래픽(neighbor-bot) DataImpulse 노하우 계승.
   ★핵심 이식:
   - DataImpulse sticky sessid 로테이션(823 로테이팅 → 10000 sticky):
     한 방문은 IP 고정(자연스러움·안정), 다음 방문은 완전히 다른 IP(엇갈림).
   - UA/엔진 일치(스토어 429 교훈)는 youtube.ts context에서 처리.
   골든시드는 계정별 배정 대신 **국적(nationality)** 으로 프록시를 고른다:
   🇰🇷 kr → country=KR, 🌍 foreign → KR 아닌 것(없으면 아무거나).
   크레덴셜은 코드 하드코딩 금지 → gs_proxies 테이블(또는 default) DB에서 읽음.
─────────────────────────────────────────────────────────── */

export interface ProxyConfig {
  server: string; // "host:port" 또는 "http://host:port"
  username?: string;
  password?: string;
}

const CACHE_MS = 60_000;
const _cache = new Map<string, { proxy: ProxyConfig | null; ts: number }>();

// 복붙 공백/개행 제거 + http:// 보정(트래픽 normalizeProxyServer 계승)
function normalizeServer(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;
  return /^(https?|socks[45]?):\/\//i.test(s) ? s : `http://${s}`;
}

// gs_proxies에서 국적에 맞는 active 프록시 한 개 — assigned_count 적은 것 우선(부하 분산)
// DataImpulse 국가 타겟팅 코드(username 끝 __cr.xx). kr→한국, foreign→미국(us) 기본.
const NATION_CC: Record<"kr" | "foreign", string> = { kr: "kr", foreign: "us" };

// username의 __cr.xx 국가코드를 원하는 국적으로 교체(없으면 붙임). DataImpulse 전용.
function applyCountry(username: string | undefined, nationality: "kr" | "foreign"): string | undefined {
  if (!username) return username;
  const cc = NATION_CC[nationality];
  const base = username.replace(/__cr\.[a-z]{2}/i, "");  // 기존 __cr.xx 제거
  return `${base}__cr.${cc}`;
}

export async function getProxyForNationality(nationality: "kr" | "foreign"): Promise<ProxyConfig | null> {
  const key = `nat_${nationality}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.proxy;

  let proxy: ProxyConfig | null = null;
  try {
    // gs_proxies에 국가별 프록시가 등록돼 있으면 그걸 우선(country 매칭)
    let q = supabase.from("gs_proxies").select("host,port,username,password,country,status").eq("status", "active");
    q = nationality === "kr" ? q.eq("country", "KR") : q.neq("country", "KR");
    const { data } = await q.order("assigned_count", { ascending: true }).limit(1).maybeSingle();
    if (data?.host && data?.port) {
      proxy = {
        server: normalizeServer(`${data.host}:${data.port}`),
        username: (data.username || "").replace(/\s+/g, "") || undefined,
        password: (data.password || "").trim() || undefined,
      };
    }
  } catch {}

  // 폴백: gs_proxies에 없으면 default_inflow_proxy(트래픽과 동일 DataImpulse 1계정) →
  //   국적에 맞게 username의 __cr.xx 국가코드만 바꿔 한국/외국 IP를 낸다(프록시 여러개 불필요).
  if (!proxy) {
    const def = await getDefaultProxy();
    if (def) proxy = { ...def, username: applyCountry(def.username, nationality) };
  }

  _cache.set(key, { proxy, ts: Date.now() });
  return proxy;
}

async function getDefaultProxy(): Promise<ProxyConfig | null> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", "default_inflow_proxy").maybeSingle();
    if (data?.value) {
      const p = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
      if (p?.server) return { server: normalizeServer(p.server), username: p.username || undefined, password: p.password || undefined };
    }
  } catch {}
  return null;
}

/* ── DataImpulse sticky 세션 발급(방문당 IP 고정) ──
   트래픽 launchBrowser의 검증 로직 그대로: 823(로테이팅) → 10000(sticky),
   username에 sessid/sessttl 붙여 이번 방문은 IP 하나로 고정, 다음 방문은 새 sessid.
   DataImpulse가 아니면(다른 프록시) 원본 그대로 반환. */
export function stickifyDataImpulse(proxy: ProxyConfig | null): ProxyConfig | null {
  if (!proxy || !/dataimpulse/i.test(proxy.server) || !proxy.username) return proxy;
  const sess = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const baseUser = proxy.username.replace(/;sess(id|ttl)\.[^;]*/g, ""); // 중복 세션 파라미터 제거
  return {
    server: proxy.server.replace(/:\d+$/, ":10000"),
    username: `${baseUser};sessid.${sess};sessttl.10`,
    password: proxy.password,
  };
}

// server 문자열을 로그에 안전 표기(주소 일부만)
export function maskProxy(proxy: ProxyConfig | null): string {
  if (!proxy) return "없음(내 IP)";
  try {
    const raw = String(proxy.server);
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    const head = u.hostname.slice(0, Math.min(3, u.hostname.length));
    return `${u.protocol}//${head}•••${u.port ? `:${u.port}` : ""}`;
  } catch { return "설정됨(주소 보호)"; }
}
