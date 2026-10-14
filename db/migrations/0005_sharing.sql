-- Groups, and how a saved cohort, analysis or custom dataset is shared (lib/access.ts, lib/groups.ts).
--
-- Each item says who may see it and who may change it:
--   visibility      'private' (its owner), 'group' (its group's members), 'public' (everyone signed
--                   in to this deployment)
--   group_can_edit  its group's members may change it as well as its owner
-- An item has at most one group, set exactly when the group matters (it is visible to, or editable
-- by, that group). Only the owner deletes an item or changes how it is shared. Deleting a group
-- returns its items to private (lib/groups.ts), so nothing is ever shared with a group that is gone.
--
-- saved_artifacts.version counts writes, so a save made from a stale copy is refused rather than
-- silently overwriting someone else's (custom datasets already have this in latest_version).
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0004. Re-runnable.

create table if not exists user_group (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  description text,
  created_by uuid not null references app_user (id),
  created_at timestamptz not null default now()
);

create table if not exists group_member (
  group_id uuid not null references user_group (id) on delete cascade,
  user_id uuid not null references app_user (id),
  -- an admin adds and removes members, renames and deletes the group
  role text not null check (role in ('admin', 'member')),
  added_by uuid references app_user (id),
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_member_user_idx on group_member (user_id);

alter table saved_artifacts add column if not exists visibility text not null default 'private';
alter table saved_artifacts add column if not exists group_id uuid references user_group (id);
alter table saved_artifacts add column if not exists group_can_edit boolean not null default false;
alter table saved_artifacts add column if not exists version integer not null default 1;
alter table saved_artifacts drop constraint if exists saved_artifacts_sharing;
alter table saved_artifacts add constraint saved_artifacts_sharing check (
  visibility in ('private', 'group', 'public')
  and (group_id is not null) = (visibility = 'group' or group_can_edit)
  and (not group_can_edit or visibility <> 'private'));
create index if not exists saved_artifacts_group_idx on saved_artifacts (group_id) where group_id is not null;
create index if not exists saved_artifacts_public_idx on saved_artifacts (kind, updated_at desc) where visibility = 'public';

alter table custom_dataset add column if not exists visibility text not null default 'private';
alter table custom_dataset add column if not exists group_id uuid references user_group (id);
alter table custom_dataset add column if not exists group_can_edit boolean not null default false;
alter table custom_dataset drop constraint if exists custom_dataset_sharing;
alter table custom_dataset add constraint custom_dataset_sharing check (
  visibility in ('private', 'group', 'public')
  and (group_id is not null) = (visibility = 'group' or group_can_edit)
  and (not group_can_edit or visibility <> 'private'));
create index if not exists custom_dataset_group_idx on custom_dataset (group_id) where group_id is not null;

-- per-principal grants were never used; sharing is the columns above
drop table if exists custom_dataset_grant;
