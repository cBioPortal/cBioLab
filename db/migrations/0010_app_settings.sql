-- Deployment settings an administrator changes at run time from /admin (lib/settings.ts): a row
-- overrides the environment variable of the same name for every server process of the deployment,
-- and deleting it returns to that variable. Only the settings lib/settings.ts lists as editable are
-- ever written; database credentials never are.
--
-- `result_cache_cleared_at` is not an environment variable: it is when an administrator last
-- cleared the result cache, and it is part of every cached entry's key (lib/next-cache.ts).
--
-- app_setting_log records every change, who made it and the value before and after.
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0009. Re-runnable.

create table if not exists app_setting (
  name text primary key check (name ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_user (id)
);

create table if not exists app_setting_log (
  id bigint generated always as identity primary key,
  name text not null,
  old_value text,
  new_value text,
  changed_at timestamptz not null default now(),
  changed_by uuid references app_user (id)
);

-- the log is append-only for the app: it may read it back for /admin, never change it
grant select, insert, update, delete on app_setting to cohort_lab_app;
grant select, insert on app_setting_log to cohort_lab_app;
