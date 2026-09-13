-- ============================================================
-- 🌱 골든시드 계정농사 — 스키마 보강 (2026-09-13)
--   1) blog_domain 컬럼 (블로그 주소) — 기존 마이그 미실행분 포함
--   2) proxy_sessid 컬럼 (계정 전용 고정 IP sessid = "처음 IP" 평생 유지)
--   + 등록/수정 RPC를 두 컬럼 포함으로 재정의
-- ✅ 재실행 안전(if not exists / or replace).
-- 실행: Supabase SQL Editor (ref nnujeovecnmestvfoiqt). ★2026-09-13 테리 Run 완료(계정3개 등록 실측).
-- ============================================================
begin;

alter table public.gs_accounts add column if not exists blog_domain  text;
alter table public.gs_accounts add column if not exists proxy_sessid text;
comment on column public.gs_accounts.blog_domain  is '네이버 블로그 주소(영문 도메인). blog.naver.com/{blog_domain}';
comment on column public.gs_accounts.proxy_sessid is '계정 전용 프록시 sessid(DataImpulse sticky). 가입 시 발급→평생 이 IP 고정. 연좌제 밴 방지.';

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
    blog_name, blog_domain, proxy_sessid, bio, profile_image_url, source, phone_used, status
  ) values (
    coalesce(nullif(p_data->>'platform',''), 'naver'),
    p_data->>'login',
    nullif(p_data->>'password',''),
    nullif(p_data->>'display_name',''),
    coalesce(nullif(p_data->>'purpose',''), 'brand_search'),
    nullif(p_data->>'target_keyword',''),
    nullif(p_data->>'target_url',''),
    nullif(p_data->>'blog_name',''),
    nullif(p_data->>'blog_domain',''),
    nullif(p_data->>'proxy_sessid',''),
    nullif(p_data->>'bio',''),
    nullif(p_data->>'profile_image_url',''),
    coalesce(nullif(p_data->>'source',''), 'bought'),
    nullif(p_data->>'phone_used',''),
    'created'
  ) returning * into rec;
  return rec;
end;
$$;

create or replace function public.gs_seed_update(p_token text, p_id uuid, p_data jsonb)
returns public.gs_accounts
language plpgsql security definer set search_path = '' as $$
declare rec public.gs_accounts;
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  update public.gs_accounts set
    login            = coalesce(nullif(p_data->>'login',''), login),
    password         = case when p_data ? 'password' then nullif(p_data->>'password','') else password end,
    phone_used       = case when p_data ? 'phone_used' then nullif(p_data->>'phone_used','') else phone_used end,
    target_keyword   = case when p_data ? 'target_keyword' then nullif(p_data->>'target_keyword','') else target_keyword end,
    target_url       = case when p_data ? 'target_url' then nullif(p_data->>'target_url','') else target_url end,
    blog_name        = case when p_data ? 'blog_name' then nullif(p_data->>'blog_name','') else blog_name end,
    blog_domain      = case when p_data ? 'blog_domain' then nullif(p_data->>'blog_domain','') else blog_domain end,
    proxy_sessid     = case when p_data ? 'proxy_sessid' then nullif(p_data->>'proxy_sessid','') else proxy_sessid end,
    display_name     = case when p_data ? 'display_name' then nullif(p_data->>'display_name','') else display_name end,
    bio              = case when p_data ? 'bio' then nullif(p_data->>'bio','') else bio end,
    profile_image_url= case when p_data ? 'profile_image_url' then nullif(p_data->>'profile_image_url','') else profile_image_url end,
    health_note      = case when p_data ? 'health_note' then nullif(p_data->>'health_note','') else health_note end
  where id = p_id
  returning * into rec;
  return rec;
end;
$$;

revoke all on function public.gs_seed_insert(text,jsonb) from public;
revoke all on function public.gs_seed_update(text,uuid,jsonb) from public;
grant execute on function public.gs_seed_insert(text,jsonb) to anon, authenticated;
grant execute on function public.gs_seed_update(text,uuid,jsonb) to anon, authenticated;

commit;
