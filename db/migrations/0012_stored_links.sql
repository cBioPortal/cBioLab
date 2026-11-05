-- Stored links (lib/link-store.ts, docs/LINKS.md): a page's long URL parameters kept under a short
-- id, so `?s=<id>` stands for them — the role legacy cBioPortal's session service plays.
--
-- The id is a hash of the parameters, so a row is written once and never changes (a trigger
-- refuses it): the same parameters always get the same id, and an id always means them. Anyone may
-- store or read one, signed in or not, as anyone may write or open a ?doc= link.
--
--   params      the parameters, name -> value, exactly as the URL carried them
--   size        their total length in characters (lib/links.ts LINK_STORE_MAX caps it)
--   set_refs    the stored id sets they name, so a set's owner is told how many links use it
--               before withdrawing it (lib/id-set-store.ts idSetUsage)
--   created_by  who stored it first, when signed in
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0011. Re-runnable.

create table if not exists stored_link (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  params jsonb not null,
  size integer not null,
  set_refs uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references app_user (id)
);
create index if not exists stored_link_set_refs_idx on stored_link using gin (set_refs);

create or replace function stored_link_immutable() returns trigger as $$
begin
  raise exception 'a stored link never changes: its id is the hash of what it holds';
end;
$$ language plpgsql;

drop trigger if exists stored_link_immutable on stored_link;
create trigger stored_link_immutable
  before update or delete on stored_link
  for each row execute function stored_link_immutable();

grant select, insert on stored_link to cohort_lab_app;
