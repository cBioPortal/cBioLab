-- Server-stored custom data: a researcher's uploaded annotations (lib/custom-data.ts), kept so
-- an analysis that uses one can be shared and re-run by others.
--
-- UNLIKE saved_artifacts, these tables hold patient and sample identifiers and the values
-- uploaded against them. They are reached only through lib/custom-store.ts, which checks
-- access on every read and write and logs every read; never query them from anywhere else.
--
-- Who may read and change a dataset: its owner and how it is shared (0004, 0005, lib/access.ts).
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0001 and 0002.

create extension if not exists pgcrypto;

create table if not exists custom_dataset (
  id uuid primary key default gen_random_uuid(),
  -- the name documents use: custom:<slug>/<COLUMN>. Unique per owner.
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null,
  owner text not null,
  level text not null check (level in ('patient', 'sample')),
  latest_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- soft delete: a pinned analysis that names a deleted dataset is refused with this date,
  -- rather than its rows silently vanishing from under it
  deleted_at timestamptz,
  unique (owner, slug)
);

-- A version is written once and never changed: a re-upload is a new version, so an analysis
-- pinned to version n always reads the same rows.
create table if not exists custom_dataset_version (
  dataset_id uuid not null references custom_dataset (id),
  version integer not null,
  columns jsonb not null,
  studies text[] not null,
  row_count integer not null,
  -- the rows as gzipped JSON ({study, patient, sample?, values[]}[]): read whole, never queried
  rows_gz bytea not null,
  sha256 text not null,
  -- the upload's match record: rows read, unmatched, duplicates, multiStudy
  source jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (dataset_id, version)
);

create or replace function custom_dataset_version_immutable() returns trigger as $$
begin
  raise exception 'custom_dataset_version rows are immutable: upload a new version instead';
end;
$$ language plpgsql;

drop trigger if exists custom_dataset_version_no_update on custom_dataset_version;
create trigger custom_dataset_version_no_update
  before update or delete on custom_dataset_version
  for each row execute function custom_dataset_version_immutable();

-- Every read of rows and every write, by whom.
create table if not exists custom_data_access_log (
  at timestamptz not null default now(),
  principal text not null,
  action text not null check (action in ('read', 'create', 'version', 'delete')),
  dataset_id uuid not null,
  version integer
);
create index if not exists custom_data_access_log_dataset_idx on custom_data_access_log (dataset_id, at desc);

drop trigger if exists custom_dataset_set_updated_at on custom_dataset;
create trigger custom_dataset_set_updated_at
  before update on custom_dataset
  for each row execute function set_updated_at();
