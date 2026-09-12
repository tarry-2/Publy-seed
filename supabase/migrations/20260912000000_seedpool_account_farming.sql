-- ============================================================
-- 🌱 STEP A — 계정농사(Seedpool) 그릇: gs_accounts 확장
-- 2026-09-12 · 목적: 비실명 계정을 "육성"해서 브랜드키워드 검색지면 장악
--   (예: 네이버 "온종일팜" 검색 → 우리가 키운 블로그들이 쭉 노출)
-- 기존 gs_accounts(youtube/instagram/facebook 시딩용)에 컬럼만 덧붙임.
--   ADD COLUMN IF NOT EXISTS → 기존 데이터/컬럼 안 건드림(안전).
-- 실행: Supabase SQL Editor에 붙여넣고 Run (ref nnujeovecnmestvfoiqt).
-- RLS 미사용(anon+앱단 필터) 기존 방침 유지.
-- ============================================================

-- ── [platform] 값 확장: youtube | instagram | facebook | naver ──
--   text 컬럼이라 제약 없음 → 'naver' 값 그대로 사용 가능(주석만 갱신).

-- ── 1) 용도/타깃 (브랜드검색점유의 핵심) ──
alter table gs_accounts add column if not exists purpose text not null default 'seeding';
--   seeding      : 유튜브/인스타 골든아워 시딩(기존)
--   brand_search : 브랜드키워드 검색지면 장악(네이버 블로그 육성)  ← 이번 목적
--   backlink     : 백링크 수신용
alter table gs_accounts add column if not exists target_keyword text;   -- 노출 노릴 키워드(예: '온종일팜')
alter table gs_accounts add column if not exists target_url text;       -- 홍보/연결 대상 URL(온종일팜 상품·도메인)

-- ── 2) 계정 출처/인증 (재사용·뺏김 리스크 추적) ──
alter table gs_accounts add column if not exists phone_used text;       -- 인증에 쓴 번호(재사용 금지 확인)
alter table gs_accounts add column if not exists source text not null default 'bought';
--   bought : 도매 구매(비실명)   |  made : 우리가 직접 생성(해외IP+SMS)
alter table gs_accounts add column if not exists is_real_verified boolean not null default false;
--   본인(실명) 인증 붙였는지. 비실명 유지 원칙 → 기본 false, 붙이면 명의귀속 주의.

-- ── 3) 블로그 프로필 육성 (빈 계정=봇티, 채워야 노출·생존) ──
alter table gs_accounts add column if not exists blog_name text;            -- 블로그명
alter table gs_accounts add column if not exists bio text;                  -- 소개글
alter table gs_accounts add column if not exists profile_image_url text;    -- 프로필 사진(계정마다 다르게)
alter table gs_accounts add column if not exists profile_done boolean not null default false;  -- 프로필 완성 여부
alter table gs_accounts add column if not exists neighbor_count int not null default 0;        -- 이웃(서이추) 수
alter table gs_accounts add column if not exists post_count int not null default 0;            -- 누적 게시물 수

-- ── 4) 상태머신 확장 (육성 단계) ──
--   status 값: created → profiled → posted → warming → ready → active → resting → banned / error
--   text라 제약 없음. 신규 계정 기본값을 'created'로.
alter table gs_accounts alter column status set default 'created';
alter table gs_accounts add column if not exists ready_at timestamptz;      -- 워밍업 졸업(준비완료) 시각

-- ── 5) 하루 한도 가드 (계정당 사람 범위 활동, 초과=밴) ──
alter table gs_accounts add column if not exists today_posts int not null default 0;
alter table gs_accounts add column if not exists today_likes int not null default 0;
alter table gs_accounts add column if not exists today_comments int not null default 0;
alter table gs_accounts add column if not exists today_follows int not null default 0;
alter table gs_accounts add column if not exists last_action_date date;     -- 오늘 카운트 리셋 기준일(KST)
alter table gs_accounts add column if not exists health_note text;          -- 캡차/재인증/의심 등 상태 메모

-- ── 6) 조회 인덱스 ──
create index if not exists idx_gs_accounts_purpose on gs_accounts(purpose, status);
create index if not exists idx_gs_accounts_keyword on gs_accounts(target_keyword);

-- ============================================================
-- ✅ 실행 후: gs_accounts 한 행 = "육성 중인 블로그 계정 1개"
--    관리자 계정농사 탭에서 수동 등록/상태보기/로테이션 → 파이프라인 검증.
-- ============================================================
