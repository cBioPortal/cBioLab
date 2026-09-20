-- Writable store for saved cohorts and analysis workspaces — the one thing
-- that must NEVER live here is a patient or sample identifier. This table
-- holds only DSL definitions (rules), never frozen membership: see
-- docs/DATA-BOUNDARY.md and RATIONALE.md's "User state" section, which
-- deliberately deferred frozen-evaluation storage for exactly this reason.
--
-- Run this once, by hand, against the Supabase project (SQL editor or any
-- Postgres client) — there is no migration runner yet, so apply migrations
-- in this directory in order and keep this file as the record of what ran.

create extension if not exists pgcrypto;

create table if not exists saved_artifacts (
  id uuid primary key default gen_random_uuid(),
  -- 'cohort': a single CohortDef. 'workspace': a full AnalysisDoc (cohorts + views).
  kind text not null check (kind in ('cohort', 'workspace')),
  name text not null,
  -- Bumped whenever the shape of `definition` changes incompatibly; read-time
  -- migration keys off this so old rows keep loading after a schema change.
  schema_version integer not null default 1,
  definition jsonb not null,
  -- Unused until auth lands (see HANDOFF.local.md) — every row is shared/public
  -- for now, the same visibility the old localStorage store had per browser.
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_artifacts_kind_idx on saved_artifacts (kind, updated_at desc);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists saved_artifacts_set_updated_at on saved_artifacts;
create trigger saved_artifacts_set_updated_at
  before update on saved_artifacts
  for each row execute function set_updated_at();
