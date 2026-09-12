-- ============================================================
-- 🌱 계정농사 — 발행 결과 기록 RPC (관리자 전용, 컨트롤타워 순차발행이 호출)
-- 2026-09-12 · 한 계정 발행이 끝날 때마다 호출.
--   성공: post_count +1, today_posts +1(KST 날짜 바뀌면 리셋 후 1), status='active', last_action_date=오늘
--   실패: 카운트 그대로, health_note에 오류 기록(어디서 실패했는지 추적)
--   관리자 세션(publy_sessions.is_admin) 검증 — 기존 gs_seed RPC와 동일 패턴.
-- ⚠️ 선행: 20260912000000(컬럼) + 20260912010000(admin RPC) 먼저 실행.
-- 실행: Supabase SQL Editor에 붙여넣고 Run (ref nnujeovecnmestvfoiqt).
-- ============================================================
begin;

create or replace function public.gs_seed_record_publish(p_token text, p_id uuid, p_success boolean, p_note text default null)
returns public.gs_accounts
language plpgsql security definer set search_path = '' as $$
declare
  rec public.gs_accounts;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  update public.gs_accounts set
    -- KST 날짜가 바뀌었으면 오늘 카운트 리셋 후 반영
    today_posts = case
      when last_action_date is distinct from v_today then (case when p_success then 1 else 0 end)
      else today_posts + (case when p_success then 1 else 0 end)
    end,
    post_count = post_count + (case when p_success then 1 else 0 end),
    last_action_date = v_today,
    -- 성공하면 투입중(active)으로. 실패는 상태 유지(밴/오류 판단은 사람이).
    status = case when p_success then 'active' else status end,
    -- 실패 사유(어디서 실패)만 health_note에 남김. 성공하면 기존 메모 유지.
    health_note = case when p_success then health_note else coalesce(p_note, health_note) end
  where id = p_id
  returning * into rec;
  return rec;
end;
$$;

revoke all on function public.gs_seed_record_publish(text,uuid,boolean,text) from public;
grant execute on function public.gs_seed_record_publish(text,uuid,boolean,text) to anon, authenticated;

commit;
-- ============================================================
-- ✅ 실행 후: 컨트롤타워가 계정별 발행 직후 이 RPC로 실적/한도를 기록.
--    today_posts 로 "오늘 이미 발행한 계정" 자동 건너뛰기(밴 방지)가 정확해짐.
-- ============================================================
