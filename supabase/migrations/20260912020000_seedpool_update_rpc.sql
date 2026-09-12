-- ============================================================
-- 🌱 계정농사 — 계정 내용 수정 RPC (관리자 전용)
-- 2026-09-12 · 등록된 계정의 비번·번호·키워드·블로그명·별명 등을 고침.
--   jsonb로 넘어온 필드만 부분 수정(안 넘긴 필드는 그대로 유지).
--   관리자 세션(publy_sessions.is_admin) 검증 — 기존 gs_seed RPC와 동일.
-- 실행: Supabase SQL Editor에 붙여넣고 Run.
-- ============================================================
begin;

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
    display_name     = case when p_data ? 'display_name' then nullif(p_data->>'display_name','') else display_name end,
    bio              = case when p_data ? 'bio' then nullif(p_data->>'bio','') else bio end,
    profile_image_url= case when p_data ? 'profile_image_url' then nullif(p_data->>'profile_image_url','') else profile_image_url end,
    health_note      = case when p_data ? 'health_note' then nullif(p_data->>'health_note','') else health_note end
  where id = p_id
  returning * into rec;
  return rec;
end;
$$;

revoke all on function public.gs_seed_update(text,uuid,jsonb) from public;
grant execute on function public.gs_seed_update(text,uuid,jsonb) to anon, authenticated;

commit;
