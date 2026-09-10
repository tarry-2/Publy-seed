-- ═══════════════════════════════════════════════════════════════
-- 🌱 골든시드 독립 회원 시스템 — 기반 테이블 (publy_users)
-- ───────────────────────────────────────────────────────────────
-- 골든시드는 퍼블리 이름만 공유할 뿐 Supabase·회원 전부 독립(중복 금지).
-- 퍼블리 운영 DB엔 publy_users CREATE 문이 없어(초기 수동생성) →
-- 코드(PublyUser interface + 참조 컬럼) + publy-traffic 마이그레이션에서
-- 실제 쓰는 컬럼을 전수 수집해 재구성했다.
-- 이 파일 뒤에 server_sessions/signup/passwords/secure_recovery(RPC)가 붙는다.
-- 실행 순서: 이 파일 → 회원 RPC 마이그레이션들.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.publy_users (
  id                       uuid primary key default gen_random_uuid(),
  email                    text not null unique,
  password_hash            text,
  name                     text,
  phone                    text,
  plan                     text not null default 'free',      -- free | basic | pro | unlimited
  app_type                 text not null default 'web',       -- app | web | both
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  last_login               timestamptz,
  last_seen                timestamptz,
  referred_by              uuid,
  memo                     text,
  joined_plan              text,
  crawl_enabled            boolean not null default false,
  place360_enabled         boolean not null default true,
  inflow_enabled           boolean not null default false,
  inflow_review_enabled    boolean not null default false,
  active_device_id         text,
  active_app_device_id     text,
  active_mobile_device_id  text,
  allow_multi_device       boolean not null default false
);

create index if not exists idx_publy_users_email on public.publy_users (lower(email));

-- 이메일 대소문자 무관 유일성(가입 중복 방지) — publy_signup이 lower(email)로 검사하지만 DB에서도 보장
create unique index if not exists uq_publy_users_email_ci on public.publy_users (lower(email));

-- 회원 기능은 SECURITY DEFINER RPC(publy_signup/login/…)로 처리한다.
-- 앱이 직접 접근하는 경로(touchLastSeen·claimActiveDevice·관리자 토글)를 위해 최소 권한만 부여.
grant select, update on public.publy_users to anon, authenticated;

-- ── publy_settings: key-value 설정(관리자 비번 admin_pw_hash·회원/관리자 설정) ──
-- server_sessions(publy_admin_login)이 value #>> '{}' 로 admin_pw_hash를 읽고,
-- server_passwords(publy_admin_change_password)가 여기 upsert 한다. 코드도 user_/admin_ 키로 사용.
create table if not exists public.publy_settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.publy_settings to anon, authenticated;

-- ── publy_mark_app_type: 가입/사용 앱 태깅(app|web|both) ──
-- signUp이 호출(try/catch로 감싸 실패해도 가입은 유지되지만, 정확한 태깅 위해 정의).
-- 퍼블리 마이그레이션엔 없어(별도 관리) 골든시드에서 재구성.
create or replace function public.publy_mark_app_type(p_user_id uuid, p_app_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.publy_users
     set app_type = case
           when app_type is null or app_type = '' or app_type = p_app_type then p_app_type
           else 'both'
         end,
         updated_at = now()
   where id = p_user_id;
end;
$$;
revoke all on function public.publy_mark_app_type(uuid, text) from public;
grant execute on function public.publy_mark_app_type(uuid, text) to anon, authenticated;

-- ── publy_quotas: 회원별 발행/사용 쿼터 ──
-- publy_session_get이 %rowtype으로 읽고(quota json 반환), 코드 getQuota/useQuota/refundQuota가
-- used_quota만 update(remaining_quota는 total-used 자동계산). 회원 1명당 1행(user_id unique).
create table if not exists public.publy_quotas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references public.publy_users(id) on delete cascade,
  total_quota      integer not null default 0,
  used_quota       integer not null default 0,
  remaining_quota  integer generated always as (total_quota - used_quota) stored,
  reset_date       date,
  updated_at       timestamptz not null default now()
);
grant select, insert, update on public.publy_quotas to anon, authenticated;
