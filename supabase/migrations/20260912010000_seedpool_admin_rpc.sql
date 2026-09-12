-- ============================================================
-- 🔒 STEP A — 계정농사(Seedpool) 보안: gs_accounts 관리자 전용 RPC
-- 2026-09-12 · gs_accounts엔 계정 login/password 등 민감정보 →
--   anon 직접 read/write 차단(비번 노출·무단 조작 방지).
--   관리자 세션(publy_sessions.is_admin) 검증하는 SECURITY DEFINER RPC로만 접근.
--   ※ place360 admin RPC와 동일 패턴(p_token = 관리자 세션토큰).
--   ⚠️ 선행: 20260912000000_seedpool_account_farming.sql(컬럼 확장) 먼저 실행.
-- 실행: Supabase SQL Editor에 붙여넣고 Run (ref nnujeovecnmestvfoiqt).
-- ============================================================
begin;

-- ── 1) gs_accounts 잠금: anon/authenticated 직접 접근 전면 차단 ──
--   (gs_proxies는 봇이 anon select로 읽으므로 건드리지 않음 — gs_accounts만)
alter table public.gs_accounts enable row level security;
revoke all on public.gs_accounts from anon, authenticated;

-- ── 2) 목록 조회 (관리자) ──
create or replace function public.gs_seed_list(p_token text, p_purpose text default null, p_platform text default null)
returns setof public.gs_accounts
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  return query
    select * from public.gs_accounts
    where (p_purpose is null or purpose = p_purpose)
      and (p_platform is null or platform = p_platform)
    order by created_at desc
    limit 2000;
end;
$$;

-- ── 3) 신규 등록 (관리자) — jsonb로 유연하게, 빈문자열은 null ──
create or replace function public.gs_seed_insert(p_token text, p_data jsonb)
returns public.gs_accounts
language plpgsql security definer set search_path = '' as $$
declare rec public.gs_accounts;
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  if coalesce(p_data->>'login', '') = '' then
    raise exception using errcode = 'P0001', message = 'LOGIN_REQUIRED';
  end if;
  insert into public.gs_accounts(
    platform, login, password, display_name, purpose, target_keyword, target_url,
    blog_name, bio, profile_image_url, source, phone_used, status
  ) values (
    coalesce(nullif(p_data->>'platform',''), 'naver'),
    p_data->>'login',
    nullif(p_data->>'password',''),
    nullif(p_data->>'display_name',''),
    coalesce(nullif(p_data->>'purpose',''), 'brand_search'),
    nullif(p_data->>'target_keyword',''),
    nullif(p_data->>'target_url',''),
    nullif(p_data->>'blog_name',''),
    nullif(p_data->>'bio',''),
    nullif(p_data->>'profile_image_url',''),
    coalesce(nullif(p_data->>'source',''), 'bought'),
    nullif(p_data->>'phone_used',''),
    'created'
  ) returning * into rec;
  return rec;
end;
$$;

-- ── 4) 상태 변경 (관리자) — ready로 가면 ready_at 기록 ──
create or replace function public.gs_seed_set_status(p_token text, p_id uuid, p_status text)
returns public.gs_accounts
language plpgsql security definer set search_path = '' as $$
declare rec public.gs_accounts;
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  update public.gs_accounts
    set status = p_status,
        ready_at = case when p_status = 'ready' and ready_at is null then now() else ready_at end
    where id = p_id
    returning * into rec;
  return rec;
end;
$$;

-- ── 5) 삭제 (관리자) ──
create or replace function public.gs_seed_delete(p_token text, p_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  delete from public.gs_accounts where id = p_id;
  return true;
end;
$$;

-- ── 6) 권한: public 회수 후 anon/authenticated 실행만 허용(내부에서 관리자 검증) ──
revoke all on function public.gs_seed_list(text,text,text) from public;
revoke all on function public.gs_seed_insert(text,jsonb) from public;
revoke all on function public.gs_seed_set_status(text,uuid,text) from public;
revoke all on function public.gs_seed_delete(text,uuid) from public;
grant execute on function public.gs_seed_list(text,text,text) to anon, authenticated;
grant execute on function public.gs_seed_insert(text,jsonb) to anon, authenticated;
grant execute on function public.gs_seed_set_status(text,uuid,text) to anon, authenticated;
grant execute on function public.gs_seed_delete(text,uuid) to anon, authenticated;

commit;
-- ============================================================
-- ✅ 실행 후: gs_accounts는 관리자 세션으로만 접근(비번 안전).
--    관리자 계정농사 탭에서 등록/상태변경/삭제 → REST 아닌 RPC 경유.
-- ============================================================
