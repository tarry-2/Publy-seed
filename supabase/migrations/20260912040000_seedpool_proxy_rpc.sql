-- ============================================================
-- 🌐 계정농사 — gs_proxies 관리자 RPC (컨트롤타워 프록시 탭이 호출)
-- 2026-09-12 · gs_proxies는 anon 읽기만 열려있고(봇이 배정에 읽음) 쓰기는 RLS 차단.
--   관리자 UI 등록/삭제/상태변경은 세션검증 SECURITY DEFINER RPC로만(비번 보호).
--   ※ gs_seed_* RPC와 동일 패턴(p_token = publy_sessions.is_admin 관리자 세션토큰).
-- 실행: Supabase SQL Editor에 붙여넣고 Run (ref nnujeovecnmestvfoiqt).
-- ============================================================
begin;

-- ── 목록 (관리자) ──
create or replace function public.gs_proxy_list(p_token text)
returns setof public.gs_proxies
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode='P0001', message='INVALID_ADMIN_SESSION';
  end if;
  return query select * from public.gs_proxies order by created_at desc limit 500;
end;$$;

-- ── 등록 (관리자) ──
create or replace function public.gs_proxy_insert(p_token text, p_data jsonb)
returns public.gs_proxies
language plpgsql security definer set search_path = '' as $$
declare rec public.gs_proxies;
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode='P0001', message='INVALID_ADMIN_SESSION';
  end if;
  if coalesce(p_data->>'host','')='' or coalesce(p_data->>'port','')='' then
    raise exception using errcode='P0001', message='HOST_PORT_REQUIRED';
  end if;
  insert into public.gs_proxies(label, host, port, username, password, kind, country, status)
  values (
    nullif(p_data->>'label',''),
    p_data->>'host',
    (p_data->>'port')::int,
    nullif(p_data->>'username',''),
    nullif(p_data->>'password',''),
    coalesce(nullif(p_data->>'kind',''),'residential'),
    coalesce(nullif(p_data->>'country',''),'KR'),
    coalesce(nullif(p_data->>'status',''),'active')
  ) returning * into rec;
  return rec;
end;$$;

-- ── 상태 변경 (관리자) — 검사 결과 active/dead 갱신 ──
create or replace function public.gs_proxy_set_status(p_token text, p_id uuid, p_status text)
returns public.gs_proxies
language plpgsql security definer set search_path = '' as $$
declare rec public.gs_proxies;
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode='P0001', message='INVALID_ADMIN_SESSION';
  end if;
  update public.gs_proxies set status=p_status, last_checked_at=now() where id=p_id returning * into rec;
  return rec;
end;$$;

-- ── 삭제 (관리자) ──
create or replace function public.gs_proxy_delete(p_token text, p_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode='P0001', message='INVALID_ADMIN_SESSION';
  end if;
  delete from public.gs_proxies where id=p_id;
  return true;
end;$$;

revoke all on function public.gs_proxy_list(text) from public;
revoke all on function public.gs_proxy_insert(text,jsonb) from public;
revoke all on function public.gs_proxy_set_status(text,uuid,text) from public;
revoke all on function public.gs_proxy_delete(text,uuid) from public;
grant execute on function public.gs_proxy_list(text) to anon, authenticated;
grant execute on function public.gs_proxy_insert(text,jsonb) to anon, authenticated;
grant execute on function public.gs_proxy_set_status(text,uuid,text) to anon, authenticated;
grant execute on function public.gs_proxy_delete(text,uuid) to anon, authenticated;

commit;
-- ============================================================
-- ✅ 실행 후: 컨트롤타워 프록시 탭이 이 RPC로 등록/삭제/상태변경.
--    봇은 기존대로 anon select로 gs_proxies 읽어 배정(변경 없음).
-- ============================================================
