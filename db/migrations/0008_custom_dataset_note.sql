-- A custom dataset's note: what the data is and where it came from, in its owner's words. It
-- describes the dataset rather than one version, so it can be changed without saving a version.
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0007.

alter table custom_dataset add column if not exists note text not null default '';
