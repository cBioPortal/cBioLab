-- A locked cohort's members in one id_set row (lib/cohort-lock-server.ts): its patients, as any
-- set's, in ids_gz; and beside them the other lists the lock froze, as named parts — "samples"
-- (those patients' samples then) and "arm:<split> / <arm>" (each split arm's patients) — so a lock
-- is one row, not one per list.
--
--   kind      'list' (a list of ids someone gave) or 'lock' (what a cohort selected when locked)
--   parts     the parts' sizes, {"samples": n, "arm:sex / Female": n, ...}; null for a list
--   parts_gz  the parts' members as gzipped JSON ({part: {study: [bare id, ...]}}); null for a list
--
-- The parts are members, so they are as immutable as ids_gz (the trigger below).
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0006. Re-runnable.

alter table id_set add column if not exists kind text not null default 'list';
alter table id_set drop constraint if exists id_set_kind;
alter table id_set add constraint id_set_kind check (kind in ('list', 'lock'));
alter table id_set add column if not exists parts jsonb;
alter table id_set add column if not exists parts_gz bytea;

create or replace function id_set_members_immutable() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'id sets are never deleted: they are soft-deleted (deleted_at), so a document naming one is refused rather than reading nothing';
  end if;
  if new.level is distinct from old.level or new.studies is distinct from old.studies
     or new.id_count is distinct from old.id_count or new.per_study is distinct from old.per_study
     or new.ids_gz is distinct from old.ids_gz or new.sha256 is distinct from old.sha256
     or new.kind is distinct from old.kind or new.parts is distinct from old.parts or new.parts_gz is distinct from old.parts_gz
     or new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at then
    raise exception 'an id set''s members are immutable: save a new set instead';
  end if;
  return new;
end;
$$ language plpgsql;
