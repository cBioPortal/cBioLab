-- Stored id sets are read by id: anyone holding a link that names a set may read its members, as
-- they may read the link itself (docs/LINKS.md). Only its owner manages it: renames, shares,
-- withdraws and restores it (lib/id-set-store.ts).
--
-- Withdrawing is the owner saying "do not use this list any more". The row and its members stay
-- (members are immutable, rows are never deleted: 0006), `deleted_at` says when, and a document
-- naming the set is refused with who withdrew it, when, the owner's note and, if they named one,
-- the set that replaces it. A withdrawal belongs to ONE set: another set holding exactly the same
-- ids is a different row and stays readable. Restoring clears all three.
--
--   withdrawn_note  why, in the owner's words (optional)
--   replaced_by     the set the owner points readers to instead (optional; never itself)
--
-- id_set_access_log gains the owner's 'withdraw' and 'restore', and reads by a reader who is not
-- signed in are logged with the principal 'anonymous'.
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0010. Re-runnable.

alter table id_set add column if not exists withdrawn_note text;
alter table id_set add column if not exists replaced_by uuid references id_set (id);
alter table id_set drop constraint if exists id_set_withdrawal;
alter table id_set add constraint id_set_withdrawal check (
  (withdrawn_note is null or length(withdrawn_note) <= 1000)
  and (replaced_by is null or replaced_by <> id)
  and (deleted_at is not null or (withdrawn_note is null and replaced_by is null)));

alter table id_set_access_log drop constraint if exists id_set_access_log_action_check;
alter table id_set_access_log add constraint id_set_access_log_action_check
  check (action in ('read', 'create', 'delete', 'withdraw', 'restore'));
