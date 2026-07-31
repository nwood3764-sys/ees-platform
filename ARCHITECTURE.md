# Anura Platform — Architecture & Operations

This document is the canonical reference for how Anura is built, deployed, and
secured. Read this before making changes — especially changes that touch
deployment, authentication, or database access.

The live site is at **https://leap.energyefficiencyservices.org**.

---

## Stack

| Layer        | Technology                                      |
|--------------|--------------------------------------------------|
| Frontend     | React + Vite, single-page app                    |
| Styling      | Inline styles with `src/data/constants.js` tokens |
| Charts       | Recharts                                         |
| Database     | Supabase (Postgres) — project ID `flyjigrijjjtcsvpgzvk` |
| Auth         | Supabase Auth (email + password)                 |
| Hosting      | Netlify — auto-deploy from GitHub master branch  |
| Source code  | GitHub — `nwood3764-sys/anura` (public)          |

---

## Repository layout

```
/
├── netlify.toml              # Build config + env vars (see Deployment below)
├── package.json
├── vite.config.js
├── index.html
└── src/
    ├── main.jsx              # Entry point
    ├── App.jsx               # Wraps everything in AuthGate
    ├── lib/
    │   └── supabase.js       # Supabase client (env-var only, no fallback)
    ├── components/
    │   ├── AuthGate.jsx      # Session boundary — login or app
    │   ├── LoginScreen.jsx   # Email + password form
    │   ├── UI.jsx            # Sidebar, Badge, Icon, ListView, etc.
    │   └── ListView.jsx      # Generic list view used by all modules
    ├── modules/
    │   ├── HomeModule.jsx        # Cross-module dashboard
    │   ├── OutreachModule.jsx    # Properties, opportunities, contacts, enrollments
    │   ├── QualificationModule.jsx   # Assessments, applications, EFR reports
    │   ├── FieldModule.jsx       # Projects, work orders, schedule
    │   └── IncentivesModule.jsx  # Payment requests, receipts
    └── data/
        ├── constants.js          # Design tokens (colors, chart palette)
        ├── mockData.js           # Legacy mock data (being phased out)
        ├── outreachService.js    # Fetchers for Outreach + property hierarchy
        ├── fieldService.js       # Fetchers for projects and work orders
        ├── incentivesService.js  # Fetchers for payment requests + receipts
        └── qualificationService.js   # Fetchers for assessments, apps, EFR
```

---

## Deployment

### How a change goes from code to live site

1. Edit files locally (or in the Claude dev container)
2. `git commit` and `git push` to `master` on the public GitHub repo
3. Netlify's GitHub integration receives the push event
4. Netlify runs `npm run build` inside a clean container with the env vars
   from `[build.environment]` in `netlify.toml` injected into the process
5. Vite build inlines the env vars into the JavaScript bundle (everything
   prefixed `VITE_` is public and compiled in)
6. Netlify publishes the `dist/` folder to the CDN at `leap.energyefficiencyservices.org`
7. SPA redirect rule in `netlify.toml` routes all paths to `index.html` so
   the React app owns client-side routing

Total time from `git push` to live site: roughly 90 seconds.

### Environment variables

**Do not use the Netlify dashboard UI to set env vars.** They live in
`netlify.toml` at the repo root, under `[build.environment]`. Committing them
to the repo keeps builds reproducible and avoids an out-of-band config step.

Current variables:

| Variable                 | Purpose                                       |
|--------------------------|-----------------------------------------------|
| `VITE_SUPABASE_URL`      | Supabase project API URL                     |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable key (safe, see Security)|
| `NODE_VERSION`           | Pinned to 20 for reproducibility              |

### Why the repo is public

Netlify's current plan allows **only one Git contributor on private repos**.
Claude's commits (and anyone else's) would be blocked with an "Unrecognized
Git contributor" error on every push. The fix was to make the repo public,
which removes that restriction.

Making the repo public is **not a security concession**: the database is
protected by row-level security (RLS, see below), not by source obscurity.
The publishable key is designed to be shipped to browsers. Nothing in the
code is a secret.

### Deploy troubleshooting

- If a build fails with "Unrecognized Git contributor," the repo has gone
  private somehow or the Netlify plan changed. Check repo visibility on
  GitHub and the Netlify team plan.
- If the site loads but shows no data, check the browser console for
  Supabase errors. Most commonly this means either (a) RLS blocked the query
  because the user isn't authenticated, or (b) the env vars didn't make it
  into the build. Both are diagnosable from the browser devtools network tab.
- If the site loads with the old UI after a push, Netlify likely rejected
  the build silently. Check `app.netlify.com/projects/ees-ops/deploys`
  for the deploy status of the top commit.

---

## Authentication

Anura uses Supabase Auth with email + password. The first thing any visitor
sees is the `LoginScreen` component. No anonymous access to anything is
permitted — the `AuthGate` component wraps the entire app and renders the
login form until a valid session exists.

### Session lifecycle

1. User lands on `leap.energyefficiencyservices.org`
2. `AuthGate` mounts, calls `supabase.auth.getSession()` to check for an
   existing session in `localStorage`
3. If a session exists and its JWT is not expired → render the app
4. If no session → render `LoginScreen`
5. User submits email + password → `supabase.auth.signInWithPassword(...)`
6. On success, Supabase returns a session, the auth-state-change listener
   in `AuthGate` fires, and the app renders
7. Session persists across page reloads via `auth.persistSession = true`
8. Token auto-refreshes via `auth.autoRefreshToken = true`
9. User clicks the sign-out button in the sidebar → `supabase.auth.signOut()`
   clears the session and the gate swaps back to the login screen

### Creating a new user

There is no self-signup flow. Users are created by an admin. Two ways:

**Option A — via the Supabase dashboard (recommended)**

1. Go to `app.supabase.com` → Anura project → Authentication → Users
2. Click "Add user" → "Create new user"
3. Enter email and temporary password, check "Auto Confirm User"
4. Share credentials securely with the user and have them change the
   password on first login

**Option B — via SQL (if the dashboard UI is unavailable)**

```sql
-- Must run inside a transaction with gen_random_uuid() available
DO $$
DECLARE new_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id, 'authenticated', 'authenticated',
    'newuser@ees-wi.org',
    crypt('TempPassword123!', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"New User"}'::jsonb,
    NOW(), NOW(), '', '', '', ''
  );
  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), new_user_id::text, new_user_id,
    jsonb_build_object(
      'sub', new_user_id::text,
      'email', 'newuser@ees-wi.org',
      'email_verified', true
    ),
    'email', NOW(), NOW(), NOW()
  );
END $$;
```

### Password reset

Today, password reset happens through the Supabase dashboard. Admins go to
Authentication → Users, find the row, and click the menu → "Send password
recovery." The user receives a reset link by email.

An in-app "change password" screen is a pending TODO.

---

## Database security

### Row-level security (RLS)

RLS is the primary access control for the database. The publishable key
is safe to ship in the browser bundle because RLS makes it functionally
impotent without a valid authenticated session.

### Current policy posture

- Every table in the `public` schema has RLS enabled
- Every table has a single `authenticated_read` SELECT policy that grants
  read access only to users in the Supabase `authenticated` role
- The Supabase `anon` role has been explicitly `REVOKE ALL` on every public
  table — no select, no insert, no update, no delete, no sequence use
- There are currently **no** INSERT/UPDATE/DELETE policies for the
  `authenticated` role. This means logged-in users can read data through
  the API but cannot write anything. Writes are only possible via the
  Supabase service-role key, which is never exposed to the client.

### What this means in practice

| Actor                                | Can read? | Can write? |
|--------------------------------------|-----------|------------|
| Anonymous visitor (no login)         | No        | No         |
| Authenticated user (signed in)       | All tables| No         |
| Service role (server only)           | All tables| All tables |
| Attacker with the publishable key    | No        | No         |

The last row is the important one: even if someone scrapes the publishable
key out of the public repo or the browser bundle, they get nothing without
a valid auth session. RLS is the lock; the key is just the doorbell.

### Adding write policies (when the time comes)

As forms get built, we'll need to add write policies table by table. The
pattern will look like this:

```sql
-- Example: allow authenticated users to insert opportunities they own
CREATE POLICY authenticated_insert_own_opportunities
  ON public.opportunities
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (
    SELECT id FROM public.users WHERE auth_user_id = auth.uid()
  ));

-- Example: allow authenticated users to update opportunities they own
CREATE POLICY authenticated_update_own_opportunities
  ON public.opportunities
  FOR UPDATE TO authenticated
  USING (owner_id = (
    SELECT id FROM public.users WHERE auth_user_id = auth.uid()
  ));
```

The `users` table bridges `auth.users` (Supabase-managed) to the app's
role/permission system. Policies should generally check `auth.uid()` against
a `users.auth_user_id` lookup.

### Role-based restrictions (future)

The current `authenticated_read` policy is intentionally broad — it lets
any logged-in user read every table. This is fine for initial development
but too loose for the final RBAC model described in the project
instructions (Project Coordinator vs Technician vs Property Owner, etc.).

When building out proper role-based access:

1. Populate the `roles`, `permissions`, `role_permissions`, and
   `field_permissions` tables (already exist in the schema)
2. Add a trigger or function that links `auth.users` rows to `users` rows
   on first sign-in, pulling the role from `users.role_id`
3. Replace the broad `authenticated_read` policies with policies that
   check the current user's role via a helper function like
   `current_user_has_role('Project Coordinator')`

---

## Supabase MCP access

The Supabase MCP server is connected to the Anura project and gives Claude
direct access. Always use it for SQL execution — never ask the user to
copy-paste SQL into the Supabase dashboard.

Project ID: `flyjigrijjjtcsvpgzvk`

Common operations:

- Schema changes → `Supabase:apply_migration` (creates a migration, applies it)
- One-off queries → `Supabase:execute_sql` (runs directly, no migration)
- Check security/performance issues → `Supabase:get_advisors`
- List tables → `Supabase:list_tables`
- List current publishable keys → `Supabase:get_publishable_keys`

Migration names should be in `snake_case` and describe the change, e.g.
`lockdown_rls_drop_dev_policies` or `add_opportunity_write_policies`.

---

## Known TODOs (as of commit 185db66)

These are the things that are known to be missing or incomplete. Take them
in whatever order makes sense for the current session.

1. **Publishable key rotation** — the current key is in git history and in
   the live repo. Rotation is defense-in-depth, not urgent, because RLS
   makes the key impotent without a session. When rotating: generate a new
   key in Supabase → update `netlify.toml` → commit → push → verify the
   deploy → disable the old key.

2. **Change Nicholas's temporary password** — it was set to `AnuraTemp2026!`
   during initial setup. User should rotate via Supabase password recovery.

3. **Write RLS policies** — add INSERT/UPDATE/DELETE policies per table as
   forms are built. Today logged-in users can read but not write anything
   via the API. See "Adding write policies" above for the pattern.

4. **Role-based read restrictions** — the current `authenticated_read`
   policy is too broad. See "Role-based restrictions (future)" above.

5. **`service_appointments` + crew scheduling** — the Schedule tab in the
   Field module currently shows an empty state. Needs a service file and
   scheduling UI.

6. **In-app password change screen** — users can't change their own
   password from inside Anura today. Add a profile/account screen with a
   password change flow using `supabase.auth.updateUser`.

7. **Bundle size** — the Vite build warns that the JS bundle is >500 KB.
   Code-split the module-level charts and Recharts imports via dynamic
   `import()` to bring this down.

8. **User join for opportunity/contact owners** — right now the display
   name for record owners is hardcoded. Wire this through a join to a
   `users` table once the auth-user-to-app-user bridge exists.

---

## How we got here (short history)

This section is for context — skip it if you know the background.

- **Phase 1: Schema + UI scaffolding.** Database schema defined per the
  project instructions, with 90+ tables covering property hierarchy,
  opportunities, projects, work orders, incentives, etc. React UI built
  with mock data.
- **Phase 2: Wire modules to Supabase.** Five modules (Home, Outreach,
  Qualification, Field, Incentives) converted from mock data to live
  fetchers against the Supabase REST API.
- **Phase 3: Deployment.** Hit a wall with Netlify's one-contributor limit
  on private repos blocking Claude's commits. Fixed by making the repo
  public — which was only safe to do after Phase 4.
- **Phase 4: Security lockdown.** Dropped the temporary dev-mode RLS
  policies that allowed anonymous reads. Added `authenticated_read`
  policies scoped to logged-in users. Built the login screen and
  `AuthGate`. Moved the publishable key out of source and into
  `netlify.toml`. Created an auth user so Nicholas can sign in.
- **Phase 5: This document exists.** Going forward, any session should
  read this file first.
