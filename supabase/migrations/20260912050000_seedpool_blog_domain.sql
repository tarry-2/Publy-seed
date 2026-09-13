-- ============================================================
-- 🌱 계정농사 — 블로그 주소(blog_domain) 컬럼 + insert/update RPC 반영
-- 2026-09-12 · 네이버는 계정≠블로그. 신규 계정은 블로그를 따로 개설해야 함.
--   블로그 주소(영문 도메인, blog.naver.com/{blog_domain})는 한 번 정하면 변경 불가.
--   자연스러운 자동생성(봇티 방지) 주소를 개설 시 확정 → 여기 저장(계정↔주소 관리).
--   ⚠️ 선행: 20260912000000·010000·020000 먼저 실행.
-- 실행: Supabase SQL Editor에 붙여넣고 Run (ref nnujeovecnmestvfoiqt).
-- ============================================================
begin;

-- ── 1) 컬럼 추가 ──
alter table public.gs_accounts add column if not exists blog_domain text;  -- 블로그 주소(영문, blog.naver.com/{이것}). 변경 불가.
comment on column public.gs_accounts.blog_domain is '네이버 블로그 주소(영문 도메인). 개설 시 확정, 변경 불가. blog.naver.com/{blog_domain}';

-- ── 2) 신규 등록 RPC 재정의 — blog_domain 포함 ──
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
    blog_name, blog_domain, bio, profile_image_url, source, phone_used, status
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
    nullif(p_data->>'bio',''),
    nullif(p_data->>'profile_image_url',''),
    coalesce(nullif(p_data->>'source',''), 'bought'),
    nullif(p_data->>'phone_used',''),
    'created'
  ) returning * into rec;
  return rec;
end;
$$;

-- ── 3) 수정 RPC 재정의 — blog_domain 포함(부분 수정) ──
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
-- ============================================================
-- ✅ 실행 후: gs_accounts.blog_domain 저장/수정 가능.
--    개설 성공 시 봇이 확정한 주소를 관리자 탭에서 gs_seed_update로 기록.
-- ============================================================
