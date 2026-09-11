-- ════════════════════════════════════════════════════════════════
-- 🌱 골든시드 회원승인(주문→관리자 승인→라이선스) 시스템
--   트래픽(publy-traffic) 검증 로직 계승. tool = 'youtube' | 'instagram'.
--   회원이 액션(조회·좋아요·댓글·구독·공유 등)을 각각 체크해 주문 →
--   관리자가 승인하면 tool_licenses.allowed_actions 에 승인 액션만 발급 →
--   회원 앱은 승인된 tool·action 만 시딩 콘솔에서 켤 수 있다.
--   관리자 인증 = 골든시드 publy_admin_login → 토큰, publy_admin_session_get(토큰) 재사용.
-- 재실행 안전(IF NOT EXISTS / OR REPLACE).
-- ════════════════════════════════════════════════════════════════

-- ── 테이블: 주문(결제요청) ──────────────────────────────────────
create table if not exists public.tool_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.publy_users(id) on delete cascade,
  customer    text not null,                 -- 회원 이메일(= tool_licenses.customer 매칭)
  name        text,
  status      text not null default 'pending',  -- pending | approved | rejected
  payload     jsonb not null default '[]'::jsonb, -- [{tool, actions:[...], plan, days}]
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index if not exists idx_tool_requests_status  on public.tool_requests(status, created_at desc);
create index if not exists idx_tool_requests_customer on public.tool_requests(customer);
grant select, insert, update, delete on public.tool_requests to anon, authenticated;

-- ── 테이블: 라이선스(승인 결과 = 실제 사용권) ─────────────────────
create table if not exists public.tool_licenses (
  id              uuid primary key default gen_random_uuid(),
  customer        text not null,             -- 회원 이메일
  tool            text not null,             -- youtube | instagram
  plan            text not null default 'basic',
  allowed_actions jsonb not null default '[]'::jsonb, -- 승인된 액션 id 배열
  expire_at       timestamptz,               -- null=무기한, 아니면 만료시각
  data_saver      text,                      -- (트래픽 호환 필드, 골든시드 미사용 가능)
  bonus_quota     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (customer, tool)
);
create index if not exists idx_tool_licenses_customer on public.tool_licenses(customer);
grant select, insert, update, delete on public.tool_licenses to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 회원용 RPC
-- ════════════════════════════════════════════════════════════════

-- 세션 토큰 → 회원 이메일/이름/id 해석(내부 헬퍼)
create or replace function public._gs_user_by_token(p_token text)
returns table(uid uuid, email text, uname text)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.email, u.name
  from public.publy_sessions s
  join public.publy_users u on u.id = s.user_id
  where s.token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex')
    and s.is_admin is not true
    and s.expires_at > now()
  limit 1;
$$;
revoke all on function public._gs_user_by_token(text) from public;

-- 주문 제출(회원): 기존 pending 있으면 갱신, 없으면 새로.
create or replace function public.submit_tool_request(p_token text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid; v_email text; v_name text; v_id uuid;
begin
  select uid, email, uname into v_uid, v_email, v_name from public._gs_user_by_token(p_token);
  if v_uid is null then
    raise exception using errcode='P0001', message='INVALID_SESSION';
  end if;

  -- 대기중 주문이 있으면 그걸 갱신(중복 방지), 없으면 새로 생성
  select id into v_id from public.tool_requests
    where customer = v_email and status = 'pending'
    order by created_at desc limit 1;

  if v_id is not null then
    update public.tool_requests
      set payload = coalesce(p_payload, '[]'::jsonb), name = v_name, created_at = now()
      where id = v_id;
  else
    insert into public.tool_requests(user_id, customer, name, status, payload)
    values (v_uid, v_email, v_name, 'pending', coalesce(p_payload,'[]'::jsonb))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.submit_tool_request(text, jsonb) from public;
grant execute on function public.submit_tool_request(text, jsonb) to anon, authenticated;

-- 내 주문 상태 조회(회원)
create or replace function public.my_tool_request(p_token text)
returns table(id uuid, status text, payload jsonb, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare v_email text;
begin
  select email into v_email from public._gs_user_by_token(p_token);
  if v_email is null then return; end if;
  return query
    select r.id, r.status, r.payload, r.created_at
    from public.tool_requests r
    where r.customer = v_email
    order by r.created_at desc
    limit 1;
end;
$$;
revoke all on function public.my_tool_request(text) from public;
grant execute on function public.my_tool_request(text) to anon, authenticated;

-- 라이선스 상태(서버시간 기준 만료판정 — 시계 조작 방지). 트래픽 계승.
create or replace function public.license_status(p_customer text, p_tool text)
returns table(server_now timestamptz, expire_at timestamptz, active boolean, plan text, allowed_actions jsonb)
language sql
security definer
set search_path = ''
as $$
  select now() as server_now,
         l.expire_at,
         (l.expire_at is null or l.expire_at > now()) as active,
         l.plan,
         l.allowed_actions
  from public.tool_licenses l
  where l.customer = p_customer and l.tool = p_tool
  limit 1;
$$;
revoke all on function public.license_status(text, text) from public;
grant execute on function public.license_status(text, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 관리자용 RPC (모두 publy_admin_session_get(p_token)으로 검증)
-- ════════════════════════════════════════════════════════════════

-- 대기중 주문 개수(빨간 배지)
create or replace function public.admin_tool_requests_pending_count(p_token text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.publy_admin_session_get(p_token) then
    raise exception using errcode='P0001', message='ADMIN_ONLY';
  end if;
  return (select count(*)::int from public.tool_requests where status = 'pending');
end;
$$;
revoke all on function public.admin_tool_requests_pending_count(text) from public;
grant execute on function public.admin_tool_requests_pending_count(text) to anon, authenticated;

-- 주문 목록(관리자). p_status null=전체
create or replace function public.admin_list_tool_requests(p_token text, p_status text)
returns table(id uuid, customer text, name text, status text, payload jsonb, created_at timestamptz, decided_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.publy_admin_session_get(p_token) then
    raise exception using errcode='P0001', message='ADMIN_ONLY';
  end if;
  return query
    select r.id, r.customer, r.name, r.status, r.payload, r.created_at, r.decided_at
    from public.tool_requests r
    where p_status is null or r.status = p_status
    order by (r.status = 'pending') desc, r.created_at desc;
end;
$$;
revoke all on function public.admin_list_tool_requests(text, text) from public;
grant execute on function public.admin_list_tool_requests(text, text) to anon, authenticated;

-- 라이선스 발급/연장(관리자). p_rows = [{customer, tool, plan, allowed_actions, days|expire_at, bonus_quota}]
create or replace function public.admin_upsert_licenses(p_token text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r jsonb; v_exp timestamptz; v_cnt int := 0;
begin
  if not public.publy_admin_session_get(p_token) then
    raise exception using errcode='P0001', message='ADMIN_ONLY';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
  loop
    -- 만료: expire_at 명시 우선, 없으면 days(일수) → now()+days, days도 없으면 유지/무기한
    if (r ? 'expire_at') and nullif(r->>'expire_at','') is not null then
      v_exp := (r->>'expire_at')::timestamptz;
    elsif (r ? 'days') and nullif(r->>'days','') is not null then
      v_exp := now() + ((r->>'days')::int || ' days')::interval;
    else
      v_exp := null;
    end if;

    insert into public.tool_licenses(customer, tool, plan, allowed_actions, expire_at, bonus_quota, updated_at)
    values (
      r->>'customer',
      r->>'tool',
      coalesce(nullif(r->>'plan',''),'basic'),
      coalesce(r->'allowed_actions','[]'::jsonb),
      v_exp,
      coalesce(nullif(r->>'bonus_quota','')::int, 0),
      now()
    )
    on conflict (customer, tool) do update
      set plan = excluded.plan,
          allowed_actions = excluded.allowed_actions,
          expire_at = case when v_exp is null and (r ? 'keep_period') then public.tool_licenses.expire_at else excluded.expire_at end,
          bonus_quota = excluded.bonus_quota,
          updated_at = now();
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end;
$$;
revoke all on function public.admin_upsert_licenses(text, jsonb) from public;
grant execute on function public.admin_upsert_licenses(text, jsonb) to anon, authenticated;

-- 주문 결정(관리자): approve(승인 시 payload→라이선스 자동 발급) / reject / delete
create or replace function public.admin_decide_tool_request(p_token text, p_id uuid, p_action text, p_rows jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_req public.tool_requests; item jsonb; v_exp timestamptz;
begin
  if not public.publy_admin_session_get(p_token) then
    raise exception using errcode='P0001', message='ADMIN_ONLY';
  end if;
  select * into v_req from public.tool_requests where id = p_id;
  if not found then return false; end if;

  if p_action = 'delete' then
    delete from public.tool_requests where id = p_id;
    return true;
  elsif p_action = 'reject' then
    update public.tool_requests set status='rejected', decided_at=now() where id = p_id;
    return true;
  elsif p_action = 'approve' then
    -- p_rows(관리자가 편집한 발급값)가 오면 그걸로, 없으면 주문 payload 그대로 라이선스 발급
    for item in select * from jsonb_array_elements(coalesce(nullif(p_rows,'null'::jsonb), v_req.payload, '[]'::jsonb))
    loop
      if (item ? 'expire_at') and nullif(item->>'expire_at','') is not null then
        v_exp := (item->>'expire_at')::timestamptz;
      elsif (item ? 'days') and nullif(item->>'days','') is not null then
        v_exp := now() + ((item->>'days')::int || ' days')::interval;
      else
        v_exp := now() + interval '30 days';
      end if;

      insert into public.tool_licenses(customer, tool, plan, allowed_actions, expire_at, bonus_quota, updated_at)
      values (
        v_req.customer,
        item->>'tool',
        coalesce(nullif(item->>'plan',''),'basic'),
        coalesce(item->'actions', item->'allowed_actions', '[]'::jsonb),
        v_exp,
        coalesce(nullif(item->>'bonus_quota','')::int, 0),
        now()
      )
      on conflict (customer, tool) do update
        set plan = excluded.plan,
            allowed_actions = excluded.allowed_actions,
            expire_at = excluded.expire_at,
            bonus_quota = excluded.bonus_quota,
            updated_at = now();
    end loop;
    update public.tool_requests set status='approved', decided_at=now() where id = p_id;
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.admin_decide_tool_request(text, uuid, text, jsonb) from public;
grant execute on function public.admin_decide_tool_request(text, uuid, text, jsonb) to anon, authenticated;

-- 라이선스 삭제/해지(관리자). p_tool null=그 회원 전체 해지
create or replace function public.admin_delete_licenses(p_token text, p_customer text, p_tool text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_cnt int;
begin
  if not public.publy_admin_session_get(p_token) then
    raise exception using errcode='P0001', message='ADMIN_ONLY';
  end if;
  delete from public.tool_licenses
    where customer = p_customer and (p_tool is null or tool = p_tool);
  get diagnostics v_cnt = row_count;
  return v_cnt;
end;
$$;
revoke all on function public.admin_delete_licenses(text, text, text) from public;
grant execute on function public.admin_delete_licenses(text, text, text) to anon, authenticated;

-- 회원 목록(관리자) — 검색·페이지네이션
create or replace function public.admin_list_users(p_token text, p_search text, p_offset int, p_limit int)
returns table(id uuid, email text, name text, plan text, is_active boolean, created_at timestamptz, phone text, last_seen timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.publy_admin_session_get(p_token) then
    raise exception using errcode='P0001', message='ADMIN_ONLY';
  end if;
  return query
    select u.id, u.email, u.name, u.plan, u.is_active, u.created_at, u.phone, u.last_seen
    from public.publy_users u
    where p_search is null or p_search = ''
       or u.email ilike '%'||p_search||'%' or u.name ilike '%'||p_search||'%'
    order by u.created_at desc
    offset coalesce(p_offset,0) limit least(coalesce(p_limit,50), 100);
end;
$$;
revoke all on function public.admin_list_users(text, text, int, int) from public;
grant execute on function public.admin_list_users(text, text, int, int) to anon, authenticated;

-- 회원 활성/비활성(관리자) — 가입 후 기본 승인 게이트
create or replace function public.admin_set_user_active(p_token text, p_user_id uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.publy_admin_session_get(p_token) then
    raise exception using errcode='P0001', message='ADMIN_ONLY';
  end if;
  update public.publy_users set is_active = p_active where id = p_user_id;
  return found;
end;
$$;
revoke all on function public.admin_set_user_active(text, uuid, boolean) from public;
grant execute on function public.admin_set_user_active(text, uuid, boolean) to anon, authenticated;
