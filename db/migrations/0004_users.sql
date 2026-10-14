-- People: who signed in, and through which identity provider (lib/users.ts, lib/auth.ts).
--
-- A deployment has one provider (Google on Vercel, MSK's Keycloak on the private cluster, a
-- development sign-in locally); a user is found by that provider's subject, and an identity is
-- linked to an existing user only through an email the provider has verified. A user can exist
-- before ever signing in — added to a group by email, or given the rows saved before accounts
-- existed (scripts/claim-legacy.ts) — and becomes that person's account when they first do.
--
-- Saved cohorts and analyses and custom datasets are owned by a user (owner_id). Rows from the
-- shared-password era have none until claimed, and until then nobody sees them.
--
-- Applied by `npm run db:migrate` (lib/migrate.ts), after 0001-0003. Re-runnable.

create table if not exists app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email like '%_@_%'),
  name text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  -- a disabled user's sign-in is refused
  disabled_at timestamptz
);

create table if not exists user_identity (
  -- the provider's issuer URL, or 'dev' for the development sign-in
  provider text not null,
  -- the provider's stable id for the person (OIDC `sub`)
  subject text not null,
  user_id uuid not null references app_user (id),
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index if not exists user_identity_user_idx on user_identity (user_id);

alter table saved_artifacts add column if not exists owner_id uuid references app_user (id);
alter table saved_artifacts drop column if exists owner;
create index if not exists saved_artifacts_owner_idx on saved_artifacts (owner_id, kind, updated_at desc);

-- custom_dataset.owner held the one shared principal; its (owner, slug) uniqueness goes with it
alter table custom_dataset add column if not exists owner_id uuid references app_user (id);
alter table custom_dataset drop column if exists owner;
create unique index if not exists custom_dataset_owner_slug_idx on custom_dataset (owner_id, slug);
