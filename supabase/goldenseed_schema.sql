-- ============================================================
-- 골든시드(GoldenSeed) DB 스키마 v0.1  (Supabase / Postgres)
-- 프로젝트: nnujeovecnmestvfoiqt (region ap-northeast-2 서울)
-- 2026-09-10 테리 SQL Editor Run 완료 → 테이블 4개 생성 실측 확인.
-- 재생성 시: Supabase SQL Editor에 붙여넣고 Run.
-- RLS: 트래픽 방식(RLS 미사용 + 봇/앱단 필터) 우선. 회원판매형 전환 시 추가.
-- ============================================================

-- [1] 프록시 풀
create table if not exists gs_proxies (
  id uuid primary key default gen_random_uuid(),
  label text,
  host text not null,
  port int not null,
  username text,
  password text,
  kind text not null default 'residential',   -- residential | mobile | datacenter
  country text not null default 'KR',
  status text not null default 'active',        -- active | dead | cooldown
  assigned_count int not null default 0,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

-- [2] 계정 풀 (총알)
create table if not exists gs_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null,                       -- youtube | instagram | facebook
  login text not null,
  password text,
  display_name text,
  status text not null default 'aging',         -- aging | active | resting | banned
  proxy_id uuid references gs_proxies(id) on delete set null,
  warmup_day int not null default 0,
  warmup_started_at timestamptz,
  last_used_at timestamptz,
  daily_action_count int not null default 0,
  session_json jsonb,
  fingerprint_json jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_gs_accounts_platform_status on gs_accounts(platform, status);

-- [3] 캠페인 (영상 1개 = 시딩 1건)
create table if not exists gs_campaigns (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  target_url text not null,
  video_type text not null default 'shorts',    -- shorts | longform | reels | post
  title text,
  status text not null default 'scheduled',     -- scheduled | running | paused | done | failed
  golden_start_at timestamptz,
  window_minutes int not null default 30,
  target_views int not null default 300,
  target_likes int not null default 10,
  target_comments int not null default 10,
  target_follows int not null default 0,
  taper boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_gs_campaigns_status on gs_campaigns(status, golden_start_at);

-- [4] 시딩 실행 로그 (액션 하나당 1행)
create table if not exists gs_seed_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references gs_campaigns(id) on delete cascade,
  account_id uuid references gs_accounts(id) on delete set null,  -- 조회는 무계정=null
  action text not null,                         -- view | like | comment | follow
  status text not null default 'success',       -- success | fail | shadow | skipped
  gateway text,                                 -- instagram | facebook | direct
  proxy_ip text,
  watch_seconds int,
  comment_text text,
  error text,
  executed_at timestamptz not null default now()
);
create index if not exists idx_gs_seed_logs_campaign on gs_seed_logs(campaign_id, executed_at);
create index if not exists idx_gs_seed_logs_account on gs_seed_logs(account_id, executed_at);
