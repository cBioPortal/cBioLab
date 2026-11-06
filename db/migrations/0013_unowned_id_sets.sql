-- Unowned id sets: a list stored by a reader who is not signed in (docs/LINKS.md). The document
-- then names the list by id, as a signed-in reader's does, so the list is stored once rather than
-- repeated in every stored link (0012) and request that carries the document.
--
-- An unowned set has no owner, so nobody manages it: it is never withdrawn, never shared and never
-- listed in anyone's saved work. It is read by id like any set. Unowned sets are stored by content:
-- the same ids at the same level are one row (the first name given is kept), so a list stored
-- again, by anyone not signed in, answers the same id.
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0012. Re-runnable.

alter table id_set alter column owner_id drop not null;

alter table id_set drop constraint if exists id_set_unowned;
alter table id_set add constraint id_set_unowned check (
  owner_id is not null
  or (deleted_at is null and visibility = 'private' and group_id is null and not group_can_edit and kind = 'list'));

create unique index if not exists id_set_unowned_content_idx on id_set (level, sha256) where owner_id is null;
