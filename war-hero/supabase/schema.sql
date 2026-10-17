-- 전쟁히어로 전체 랭킹 — Supabase SQL Editor 에 통째로 붙여 넣고 Run.
-- 구조
--   scores         : 공개 랭킹 (누구나 읽기만 가능)
--   score_secrets  : 플레이어별 비밀값 해시 (아무도 직접 못 읽음)
--   submit_score() : 점수 등록 함수. 처음 등록한 브라우저의 비밀값과 일치해야 갱신된다.
--                    점수는 그 플레이어의 최고 기록만 남는다.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.scores (
  id          uuid primary key,
  callsign    text        not null check (char_length(callsign) between 1 and 14),
  score       bigint      not null default 0 check (score between 0 and 1000000000000),
  stage       smallint    not null default 0 check (stage between 0 and 3),
  stage_name  text        check (char_length(stage_name) <= 20),
  diff        text        check (diff in ('쉬움', '보통', '어려움')),
  region      text        check (char_length(region) <= 40),
  share       smallint    check (share between 0 and 100),
  updated_at  timestamptz not null default now()
);
create index if not exists scores_score_idx on public.scores (score desc);

create table if not exists public.score_secrets (
  id          uuid primary key,
  secret_hash text not null
);

alter table public.scores enable row level security;
alter table public.score_secrets enable row level security;

-- 랭킹은 누구나 읽기만. 쓰기 정책은 일부러 만들지 않는다(함수로만 쓴다).
drop policy if exists "scores are public" on public.scores;
create policy "scores are public" on public.scores for select to anon, authenticated using (true);
grant select on public.scores to anon, authenticated;
revoke insert, update, delete on public.scores from anon, authenticated;
revoke all on public.score_secrets from anon, authenticated;

create or replace function public.submit_score(
  p_id uuid, p_secret text, p_callsign text, p_score bigint, p_stage int,
  p_stage_name text, p_diff text, p_region text, p_share int
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text := encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex');
  v_old  text;
begin
  if char_length(coalesce(p_secret, '')) < 32 then
    raise exception 'invalid secret';
  end if;

  select secret_hash into v_old from public.score_secrets where id = p_id;
  if v_old is null then
    insert into public.score_secrets (id, secret_hash) values (p_id, v_hash);
  elsif v_old <> v_hash then
    raise exception 'forbidden';
  end if;

  insert into public.scores as s (id, callsign, score, stage, stage_name, diff, region, share, updated_at)
  values (p_id, left(trim(p_callsign), 14), greatest(p_score, 0), p_stage, left(p_stage_name, 20), p_diff, left(p_region, 40), p_share, now())
  on conflict (id) do update
    set callsign   = excluded.callsign,
        score      = greatest(s.score, excluded.score),
        stage      = case when excluded.score >= s.score then excluded.stage      else s.stage      end,
        stage_name = case when excluded.score >= s.score then excluded.stage_name else s.stage_name end,
        diff       = case when excluded.score >= s.score then excluded.diff       else s.diff       end,
        region     = case when excluded.score >= s.score then excluded.region     else s.region     end,
        share      = case when excluded.score >= s.score then excluded.share      else s.share      end,
        updated_at = now();
end;
$$;

revoke all on function public.submit_score(uuid, text, text, bigint, int, text, text, text, int) from public;
grant execute on function public.submit_score(uuid, text, text, bigint, int, text, text, text, int) to anon, authenticated;
