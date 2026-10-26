-- The app's own database role, holding only what the app does to each table. A deployment's app
-- connects as it (DATABASE_URL) while migrations keep the tables' owner (MIGRATION_DATABASE_URL), so
-- the app cannot alter, drop or truncate a table, disable a trigger, rewrite a stored dataset version
-- or touch an access log, whatever its code does. Its login and password are set outside the
-- migrations, by scripts/db-app-role.ts, so no secret lives here.
--
-- Every table a later migration adds needs its grants here or in that migration; the tests refuse a
-- table the role was given nothing on.
do $$ begin
  if not exists (select from pg_roles where rolname = 'cohort_lab_app') then create role cohort_lab_app nologin; end if;
end $$;

grant usage on schema public to cohort_lab_app;

grant select, insert, update on app_user to cohort_lab_app;
grant select, insert on user_identity to cohort_lab_app;
grant select, insert, update, delete on user_group, group_member to cohort_lab_app;
grant select, insert, update, delete on saved_artifacts to cohort_lab_app;
grant select, insert, update on campaigns to cohort_lab_app;
grant select, insert, update, delete on campaign_hypotheses to cohort_lab_app;
grant select, insert, update on custom_dataset to cohort_lab_app;
grant select, insert on custom_dataset_version to cohort_lab_app;
grant select, insert, update on id_set to cohort_lab_app;
-- written, never read back by the app
grant insert on custom_data_access_log, id_set_access_log to cohort_lab_app;

-- Supabase's API roles are given every new table in public, for its REST API with the project's
-- anon key; the app never uses that API, and the tables hold patient-level uploads.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
    end if;
  end loop;
end $$;
