-- Stored id sets: a cohort given as a list of sample or patient ids, kept on the server so a
-- document names it by id (`{"kind":"sampleList","set":"<uuid>"}`) instead of carrying every id
-- in its JSON, its ?doc= link and every request (lib/id-set-store.ts, lib/id-sets.ts).
--
-- LIKE custom_dataset, these tables hold patient and sample identifiers. They are reached only
-- through lib/id-set-store.ts, which checks access on every read and write and logs every read;
-- never query them from anywhere else.
--
-- A set's members never change once written (a trigger refuses it): a document that names a set
-- always means the same samples. A different list is a new set. Its name and sharing may change.
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0005. Re-runnable.

create table if not exists id_set (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  owner_id uuid not null references app_user (id),
  level text not null check (level in ('patient', 'sample')),
  studies text[] not null,
  -- how many ids it holds, and per study (jsonb {study: n})
  id_count integer not null,
  per_study jsonb not null,
  -- the members as gzipped JSON ({study: [bare id, ...]}): read whole, never queried
  ids_gz bytea not null,
  sha256 text not null,
  -- how the list was matched when it was saved: ids given, unmatched, duplicates
  source jsonb not null,
  visibility text not null default 'private',
  group_id uuid references user_group (id),
  group_can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- soft delete: a document naming a deleted set is refused with this date, rather than its
  -- cohort silently becoming empty
  deleted_at timestamptz,
  constraint id_set_sharing check (
    visibility in ('private', 'group', 'public')
    and (group_id is not null) = (visibility = 'group' or group_can_edit)
    and (not group_can_edit or visibility <> 'private'))
);
create index if not exists id_set_owner_idx on id_set (owner_id, created_at desc);
create index if not exists id_set_group_idx on id_set (group_id) where group_id is not null;

create or replace function id_set_members_immutable() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'id sets are never deleted: they are soft-deleted (deleted_at), so a document naming one is refused rather than reading nothing';
  end if;
  if new.level is distinct from old.level or new.studies is distinct from old.studies
     or new.id_count is distinct from old.id_count or new.per_study is distinct from old.per_study
     or new.ids_gz is distinct from old.ids_gz or new.sha256 is distinct from old.sha256
     or new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at then
    raise exception 'an id set''s members are immutable: save a new set instead';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists id_set_immutable on id_set;
create trigger id_set_immutable
  before update or delete on id_set
  for each row execute function id_set_members_immutable();

drop trigger if exists id_set_set_updated_at on id_set;
create trigger id_set_set_updated_at
  before update on id_set
  for each row execute function set_updated_at();

-- Every read of members and every write, by whom.
create table if not exists id_set_access_log (
  at timestamptz not null default now(),
  principal text not null,
  action text not null check (action in ('read', 'create', 'delete')),
  set_id uuid not null
);
create index if not exists id_set_access_log_set_idx on id_set_access_log (set_id, at desc);
