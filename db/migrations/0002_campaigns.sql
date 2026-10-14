-- Hypothesis campaigns: a pre-registration ledger. A campaign is a question plus a list of
-- hypotheses (each an Analysis document with one declared primary result); locking it
-- timestamps the list BEFORE any result exists, and the triggers below make a locked list
-- immutable at the database level — the application cannot add, drop or rewrite a
-- hypothesis after seeing results even if its own code is wrong. Results are written
-- into the same rows, nulls included, so a report can always say "1 of N tested".
--
-- Like saved_artifacts, this holds definitions and aggregate results only — never a
-- patient or sample identifier (see docs/DATA-BOUNDARY.md).
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0001.

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  study text not null,
  -- decision rules fixed at creation: FDR, replication alpha, minimum arm size
  plan jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'locked', 'running', 'complete')),
  -- sha256 over the sorted hypothesis hashes at lock time: the pre-registration receipt
  ledger_hash text,
  locked_at timestamptz,
  completed_at timestamptz,
  owner text,
  created_at timestamptz not null default now()
);

create table if not exists campaign_hypotheses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete restrict,
  position integer not null,
  statement text not null,
  rationale text,
  -- {doc, primary, direction}: the test itself
  spec jsonb not null,
  hash text not null,
  -- 'generator' (an AI proposed it) or 'researcher' (a person added it)
  source text not null default 'generator',
  -- arm sizes on the discovery half, computed from cohort definitions only (no outcome)
  feasibility jsonb,
  discovery jsonb,
  q double precision,
  validation jsonb,
  verdict text,
  registered_at timestamptz not null default now()
);

create index if not exists campaign_hypotheses_campaign_idx on campaign_hypotheses (campaign_id, position);
create index if not exists campaign_hypotheses_hash_idx on campaign_hypotheses (hash);

-- A locked campaign's hypothesis list cannot change: no insert, no delete, and no edit to
-- what a hypothesis IS (statement, spec, hash, source). Result columns stay writable.
create or replace function campaign_hypotheses_frozen() returns trigger as $$
declare locked timestamptz;
begin
  select locked_at into locked from campaigns where id = coalesce(new.campaign_id, old.campaign_id);
  if locked is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' or tg_op = 'DELETE' then
    raise exception 'campaign is locked: its hypothesis list is frozen';
  end if;
  if new.statement is distinct from old.statement or new.spec is distinct from old.spec
     or new.hash is distinct from old.hash or new.source is distinct from old.source
     or new.campaign_id is distinct from old.campaign_id or new.position is distinct from old.position then
    raise exception 'campaign is locked: a registered hypothesis cannot be edited';
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists campaign_hypotheses_frozen on campaign_hypotheses;
create trigger campaign_hypotheses_frozen before insert or update or delete on campaign_hypotheses
  for each row execute function campaign_hypotheses_frozen();

-- A lock, once taken, is permanent, and so are the plan and the receipt.
create or replace function campaigns_lock_permanent() returns trigger as $$
begin
  if old.locked_at is not null and (new.locked_at is distinct from old.locked_at
     or new.ledger_hash is distinct from old.ledger_hash or new.plan is distinct from old.plan
     or new.question is distinct from old.question or new.study is distinct from old.study) then
    raise exception 'campaign is locked: its lock, plan and receipt are permanent';
  end if;
  if tg_op = 'DELETE' and old.locked_at is not null then
    raise exception 'a locked campaign cannot be deleted';
  end if;
  return coalesce(new, old);
end $$ language plpgsql;

drop trigger if exists campaigns_lock_permanent on campaigns;
create trigger campaigns_lock_permanent before update or delete on campaigns
  for each row execute function campaigns_lock_permanent();
