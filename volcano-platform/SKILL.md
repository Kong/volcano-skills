---
name: volcano-platform
description: Use for every Volcano project build, scaffold, local run, test, or deploy. Covers canonical project shape, Functions and frontends, migrations, volcano-config.yaml, environment variables, shared code, and the build and deploy workflow. Pair with volcano-sdk for application features.
---
# Volcano Platform Contract Skill

## Before anything else: check the Volcano CLI

Run `which volcano` and
`env -u VOLCANO_GITHUB_RELEASES_URL -u VOLCANO_CLI_RELEASES_URL volcano --version`.
If a working CLI is installed,
record its version and continue without upgrading it. Keep both release-source
overrides cleared for every CLI invocation and npm install in this workflow,
including deferred binary downloads. If it is missing, read
the bundled `../install-volcano/SKILL.md` and follow its exact-version package
verification procedure. Do not fetch and execute installation instructions,
run remote shell installers, or use a moving release or branch as an executable
source. Only upgrade when the user requests it, using the same verified,
versioned installation procedure. If installation cannot be verified, report
the prerequisite and continue only with independent work.

## Role & Pairing
Defines the canonical project shape and deploy contract for any Volcano-Hosting-deployable codebase. Covers the `volcano/functions/` deployment model, migrations, `volcano-config.yaml`, environment variables, shared-code conventions, and the build/deploy workflow.

**Pair with:**
- `volcano-sdk` — the SDK entrypoint and skill router.
- `volcano-functions` — function-writing internals: handler templates, invocation contract, user-context patterns, error handling.

This skill focuses on **project shape and deploy mechanics**, not on how to write individual function handlers.

## Relationship to `volcano init`

`volcano init` (from the Volcano CLI) creates a minimal runtime skeleton in a `volcano/` directory:

```
volcano/                        # Volcano-managed project directory
volcano/.gitignore              # ignores *.env (volcano.env, cloud.env), .env.local, logs; before CLI 0.46.0 only volcano.env
volcano/volcano.env             # local server's environment variables (gitignored)
volcano/volcano.env.example     # env var documentation (committed)
volcano/migrations/             # SQL migration files
volcano/migrations/README.md    # migration conventions
volcano/README.md               # next-step instructions
```

Templates add language-specific files on top of the base scaffold:
- `volcano init nextjs` (aliases: `next`, `next.js`, `next-js`) — adds a minimal Next.js app under `web/` plus example functions and migrations.
- `volcano init javascript` (aliases: `js`, `node`, `nodejs`) — adds a starter function handler and `volcano-config.yaml`.
- `volcano init python` (alias: `py`) — adds a Python function handler.
- `volcano init ruby` (alias: `rb`) — adds a Ruby function handler.

Add `--example` for a more complete demo: `volcano init nextjs --example notes`, or `volcano init javascript|python|ruby --example hello-world`.

Note: `volcano-config.yaml` comes with `volcano init javascript` (with or without `--example hello-world`) and `volcano init nextjs --example notes`, not with the base scaffold or the other templates. You can also create it manually at `volcano/volcano-config.yaml`.

`volcano init` does **not** create an `src/api/` directory, an OpenAPI dispatcher, or a single bundled entry point. Functions deploy individually from `volcano/functions/`.

## Project Layout (canonical)

```
.
├── volcano/                        # Volcano-managed directory (created by volcano init)
│   ├── functions/                  # Function handlers (deployment root)
│   │   ├── hello.js                # → deploys as function "hello"
│   │   ├── notes-summary.js        # → deploys as function "notes-summary"
│   │   ├── api/                    # → deploys as function "api" (directory function)
│   │   │   └── index.js            # entry point inside a directory function
│   │   └── _shared/                # shared code (underscore-prefixed, auto-bundled)
│   │       └── volcano-client.js   # canonical client factory
│   ├── migrations/
│   │   ├── 001_init.sql            # numeric-prefix alphabetical ordering
│   │   └── 002_add_posts.sql
│   ├── volcano-config.yaml         # declarative project config (see "volcano-config.yaml" below)
│   ├── volcano.env                 # local server's env vars (gitignored)
│   ├── cloud.env                   # cloud project's env vars (you create it; check it's gitignored)
│   ├── volcano.env.example         # env var documentation (committed)
│   └── .gitignore
├── package.json                    # optional — needed only for the build model
├── tsconfig.json                   # optional — needed only for the build model
└── src/                            # optional — authoring source for the build model
    ├── functions/
    │   ├── hello.ts
    │   └── notes-summary.ts
    └── lib/
        └── volcano-client.ts
```

**Hard rules:**
- Function handlers live ONLY under `volcano/functions/`.
- Migrations live ONLY under `volcano/migrations/`.
- Shared code that functions import at runtime uses the `_`-prefix convention (`_shared/`, `_lib/`) so the scanner skips it as a function candidate but the packager bundles it.
- `volcano-config.yaml` is the declarative config for the full project (project settings, databases, variables, buckets/policies, realtime, auth, functions/schedulers, frontends) — see "volcano-config.yaml" below, not just buckets and function visibility.

## Function Deployment Model

`volcano functions deploy` scans `volcano/functions/` and deploys each handler as an individual function.

**Scanner rules** (source: `volcano-cli/internal/function/scanner.go`):
- Scans ONLY the `volcano/functions/` directory (hard-coded path).
- **One function per file:** `hello.js` → function named `hello`.
- **One function per directory:** `api/index.js` → function named `api` (the directory name).
- Entries starting with `_` are **skipped** as function candidates but bundled as shared code when imported.
- Supported runtimes: `nodejs22.x` (minimum), `nodejs24.x` (default). Also Python and Ruby.

There is **no router, no OpenAPI dispatcher, no single entry point**. Each file is an independent function with its own URL.

## Event & Response Shape

### Event (IN)
Functions receive the **bare caller payload** as `event`. There is no `httpMethod`, `path`, or `queryStringParameters`. If the caller invokes with `{ name: 'Alice' }`, the handler receives exactly that object.

When the request carries a valid Bearer token **and the payload is an object/map**, Volcano injects `__volcano_auth` into the event:

```ts
type VolcanoAuth = {
  user_id: string;
  email: string;
  project_id: string;
  role: string;
  access_token: string;
};
```

**Caveat:** if the payload is not an object (string, number, array), `__volcano_auth` is **not** injected — the payload passes through unchanged. Always guard for its absence.

### Response (OUT)
```ts
type FunctionResponse = {
  statusCode: number;
  body: string;              // always JSON.stringify(...) for JSON responses
  headers?: Record<string, string>;
};
```

**Use `statusCode: 200` for every successful response — not `201`, `202`, or
any other 2xx.** `volcano functions invoke` reports any non-200 status as a
failed invocation (e.g. `Error: failed to invoke function "x": HTTP 201`),
so returning `201 Created` for a create makes the CLI — and an agent reading
its output — treat a working function as broken and thrash trying to "fix"
it. Return `200` with the created/updated resource in the `body`; reserve
non-2xx for real failures (`400` bad input, `401` unauthenticated, `500`
internal).

### Handler signature
```js
exports.handler = async (event) => {
  const auth = event && typeof event === 'object' ? event.__volcano_auth : undefined;
  // ...
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
```

For detailed handler templates, invocation patterns, and user-context guidance, see the `volcano-functions` skill.

## Authoring Models

### Model A — Native JavaScript (what `volcano init` scaffolds)

Author `.js` handlers directly in `volcano/functions/`. Share code via `volcano/functions/_shared/` using the underscore-prefix convention. The packager bundles `_shared/` into each function archive alongside the entrypoint, so `require("./_shared/...")` resolves at runtime.

```js
// volcano/functions/hello.js
exports.handler = async (event) => {
  const name = event?.name || 'World';
  return {
    statusCode: 200,
    body: JSON.stringify({ message: `Hello, ${name}!` }),
  };
};
```

```js
// volcano/functions/_shared/volcano-client.js  — shared across functions
const { VOLCANO_API_URL, VOLCANO_ANON_KEY, VOLCANO_DATABASE = 'app' } = process.env;

function createVolcanoClient(VolcanoAuthClass, { apiUrl, anonKey, database = 'app', accessToken }) {
  if (!apiUrl || !anonKey) throw new Error('Missing VOLCANO_API_URL or VOLCANO_ANON_KEY');
  const volcano = new VolcanoAuthClass({ apiUrl, anonKey, ...(accessToken && { accessToken }) });
  return volcano.database(database);
}

const createFunctionVolcanoClient = (VolcanoAuthClass, auth) => {
  if (!auth?.access_token) throw new Error('Missing function auth access token');
  return createVolcanoClient(VolcanoAuthClass, {
    apiUrl: VOLCANO_API_URL,
    anonKey: VOLCANO_ANON_KEY,
    database: VOLCANO_DATABASE,
    accessToken: auth.access_token,
  });
};

module.exports = { createVolcanoClient, createFunctionVolcanoClient };
```

```js
// volcano/functions/notes-summary.js  — uses shared client
const { createFunctionVolcanoClient } = require('./_shared/volcano-client');

let VolcanoAuthClass;
async function getVolcanoAuthClass() {
  if (!VolcanoAuthClass) {
    const sdk = await import('@volcano.dev/sdk');
    VolcanoAuthClass = sdk.VolcanoAuth || sdk.default;
  }
  return VolcanoAuthClass;
}

exports.handler = async (event) => {
  const input = event && typeof event === 'object' ? event : {};
  const auth = input.__volcano_auth;
  if (!auth?.access_token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const VolcanoAuth = await getVolcanoAuthClass();
  const volcano = createFunctionVolcanoClient(VolcanoAuth, auth);
  const { data, error } = await volcano.from('notes').select('id,title').limit(5);
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, body: JSON.stringify({ notes: data ?? [] }) };
};
```

**A Model A function that imports an npm package (including `@volcano.dev/sdk`, as `notes-summary.js` does) MUST declare it in a `package.json`, or the import fails at runtime with `Cannot find package '@volcano.dev/sdk'`.** `volcano functions deploy` uploads dependency *manifests* (`package.json`) and lets the runtime install from them; it deliberately never uploads your local `node_modules` (it's excluded from the archive). Declaring the import is not enough on its own — there must be a manifest listing it:

```json
// volcano/functions/package.json  — declares deps for the native-JS functions
{
  "name": "functions",
  "private": true,
  "dependencies": { "@volcano.dev/sdk": "latest" }
}
```

The scanner skips `package.json`/`node_modules` as function candidates (they are not handlers), so this file sits alongside your `.js` handlers without becoming its own function. `hello.js` above needs no manifest because it imports nothing.

### Model B — Build-into-functions (TypeScript)

Author TypeScript in `src/functions/<name>.ts`, bundle each to `volcano/functions/<name>.js` with esbuild, then deploy. This lets you use TypeScript, `src/lib/` shared code, and npm dependencies that esbuild bundles.

**`package.json`:**
```json
{
  "name": "my-volcano-project",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build:functions": "esbuild src/functions/*.ts --bundle --platform=node --target=node22 --format=cjs --outdir=volcano/functions",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@volcano.dev/sdk": "latest"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.2"
  }
}
```

**`tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

**Source handler (`src/functions/hello.ts`):**
```ts
import { createFunctionVolcanoClient } from '../lib/volcano-client';

export const handler = async (event: { name?: string; __volcano_auth?: { access_token?: string } }) => {
  const name = event.name || 'World';
  return { statusCode: 200, body: JSON.stringify({ message: `Hello, ${name}!` }) };
};
```

After `npm run build:functions`, the output `volcano/functions/hello.js` is what deploys.

**Critical:** `volcano functions deploy` does NOT run your build. The built `.js` files must already exist under `volcano/functions/` on disk. Always run `npm run build:functions` before deploying. Committing the built output is the safest approach — the packager applies project ignore rules when bundling directory contents and shared libraries, so gitignoring `volcano/functions/` can cause packaging edge cases.

## Canonical Shared Client Pattern

Both models use the same factory pattern, adapted from the `nextjs-notes` starter (`volcano/functions/_shared/volcano-client.js`):

| Factory | When to use |
|---|---|
| `createFunctionVolcanoClient(VolcanoAuthClass, auth)` | Inside function handlers — uses `__volcano_auth.access_token` |
| `createWebVolcanoClient(VolcanoAuthClass)` | Browser/Next.js — uses `NEXT_PUBLIC_*` env vars |

Both read `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, and `VOLCANO_DATABASE` from `process.env` and fall back to database name `'app'`.

For browser-side client setup, see the `volcano-nextjs` skill.

## Environment Variables

Functions receive **only user-defined project variables**. Volcano does **not** auto-inject `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, or `VOLCANO_DATABASE` into the function runtime. You must define these as project variables.

**Deploy variables:**
```sh
volcano variables deploy
```
This reads from `volcano/volcano.env` (or a specified file) and sets project-scoped environment variables that all functions in the project receive at runtime. `volcano deploy` runs the same step first, before any function or frontend that reads them (see "Deploy & Local-Dev Workflow").

`volcano/volcano.env` holds the local server's values (`http://localhost:8000` and its fixed keys). Keep the cloud project's values in `volcano/cloud.env` and name it on cloud commands: `volcano cloud variables deploy -f volcano/cloud.env`, `volcano cloud deploy --env-file volcano/cloud.env`. `volcano cloud deploy` refuses an env file holding the local server's keys or a localhost `VOLCANO_API_URL`.

**Canonical variable names** (the shared client factory expects these):
| Variable | Purpose |
|---|---|
| `VOLCANO_API_URL` | Volcano API endpoint |
| `VOLCANO_ANON_KEY` | Public anon key |
| `VOLCANO_DATABASE` | Database name (defaults to `'app'` if unset) |

**Custom secrets** (any name): `STRIPE_SECRET_KEY`, `SENDGRID_API_KEY`, `SLACK_WEBHOOK_URL`, etc.

**`volcano/volcano.env.example`** (committed for documentation):
```env
VOLCANO_API_URL=https://api.volcano.dev
VOLCANO_ANON_KEY=your-anon-key
VOLCANO_DATABASE=app

# Custom secrets (add as needed)
# STRIPE_SECRET_KEY=sk-...
```

Never hardcode secrets in handler code.

**`DATABASE_URL` is auto-injected** (unlike `VOLCANO_API_URL`/`VOLCANO_ANON_KEY`/`VOLCANO_DATABASE` above) and carries full admin access (`application_name=volcano_full_access`) by default. Always use the SDK client (`volcano.from(...)`), not `DATABASE_URL`. Direct Postgres access is a discouraged last resort with untested, unbounded surface area — see the `volcano-database` skill's "Direct Postgres Access" section before ever reaching for it.

## Migrations & Row-Level Security

### Migration conventions
- **Location:** `volcano/migrations/` (no subdirectories).
- **Filename:** `NNN_description.sql` — numeric prefix for alphabetical ordering (e.g., `001_init.sql`, `002_add_posts.sql`). Ordering is alphabetical; the numeric prefix is a convention, not enforced.
- **Idempotency:** use `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`, and `CREATE OR REPLACE FUNCTION`.
- **One statement per file:** `volcano migrations deploy` executes each file as a single SQL
  statement — it does not split on `;` or batch multiple statements, and
  rejects a multi-statement body outright (`ERROR: Multiple statements are
  not supported`). Do NOT wrap a file in `BEGIN; ... COMMIT;`, and do NOT put
  more than one statement in one file. A schema change that needs several
  statements (create table, add indexes, enable RLS, add policies) is
  several sequentially-numbered files, not one — see "Canonical migration
  with RLS" below.

**Deploy:**
```sh
volcano migrations deploy --all -d app
```
`volcano deploy --with-migrations` applies them as part of a whole-project
deploy. Neither command tracks which files already ran: every run applies
every file again, so keep each one safe to re-run.

### Auth helper functions

Volcano automatically installs these SQL helper functions in **every project database** (source: `volcano-hosting/internal/database/auth_helpers.go`). They read JWT claims from PostgreSQL session variables set by the request pipeline.

| Helper | Session variable | Returns |
|---|---|---|
| `auth.uid()` | `request.jwt_sub` | `UUID` — authenticated user's id (or NULL) |
| `auth.email()` | `request.jwt_email` | `TEXT` — authenticated user's email |
| `auth.role()` | `request.jwt_role` | `TEXT` — `'authenticated'`, `'anonymous'`, or `'anon'` (see below) |
| `auth.is_authenticated()` | (derived) | `BOOLEAN` — `auth.uid() IS NOT NULL` |

**Important:** the schema prefix `auth.` is required. Write `auth.uid()`, not bare `uid()`.

**`auth.role()` has three distinct values, not two:**
- `'authenticated'` — a real signed-up user (email/password or OAuth).
- `'anonymous'` — a guest user created via `signUpAnonymous()`. They DO have a valid JWT and a real `auth.uid()`; RLS still applies to them like any authenticated caller.
- `'anon'` — no token at all (the SQL function's fallback default, and also the underlying Postgres role name for unauthenticated access).

A policy that checks `auth.role() = 'anon'` to gate out guests is a common mistake — guest sessions report `'anonymous'`, not `'anon'`. Prefer `auth.uid() IS NOT NULL` (or `auth.is_authenticated()`) when the intent is "any signed-in caller, including guests."

### Canonical migration with RLS

One statement per file, numbered sequentially — each `-- <filename>` comment
below marks a separate file, not a section of one file:

```sql
-- 001_create_posts_table.sql
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 002_posts_user_id_index.sql
CREATE INDEX IF NOT EXISTS posts_user_id_idx ON posts(user_id);

-- 003_posts_created_at_index.sql
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);

-- 004_posts_enable_rls.sql
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- 005_posts_policy_select_own_drop.sql
DROP POLICY IF EXISTS posts_select_own ON posts;

-- 006_posts_policy_select_own_create.sql
CREATE POLICY posts_select_own ON posts
    FOR SELECT USING (user_id = auth.uid());

-- 007_posts_policy_insert_own_drop.sql
DROP POLICY IF EXISTS posts_insert_own ON posts;

-- 008_posts_policy_insert_own_create.sql
CREATE POLICY posts_insert_own ON posts
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- 009_posts_policy_update_own_drop.sql
DROP POLICY IF EXISTS posts_update_own ON posts;

-- 010_posts_policy_update_own_create.sql
CREATE POLICY posts_update_own ON posts
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 011_posts_policy_delete_own_drop.sql
DROP POLICY IF EXISTS posts_delete_own ON posts;

-- 012_posts_policy_delete_own_create.sql
CREATE POLICY posts_delete_own ON posts
    FOR DELETE USING (user_id = auth.uid());
```

For public-read patterns, add a policy (its own file) with `USING (status = 'published')` alongside the owner policies.

## volcano-config.yaml

Declarative configuration for the full project: project settings, database
assertions, variables, buckets/policies, realtime, auth (providers, email,
templates, managed pages), function visibility/schedulers, and frontend
custom domains and function routes. Located at `volcano/volcano-config.yaml` or root
`volcano-config.yaml`. Only declared sections are reconciled — everything
else is left untouched.

`pull` exports the target's current configuration to a file; `deploy`
uploads a file and reconciles the target to match it. Only the command
namespace changes between local and cloud:

| Target | Export to file | Apply from file |
|---|---|---|
| Local (`volcano start`) | `volcano config pull` | `volcano config deploy` |
| Cloud (`volcano login` + `volcano use`) | `volcano cloud config pull` | `volcano cloud config deploy` |

Use `pull` to seed a manifest from an existing project instead of
hand-writing one from scratch, and `deploy --dry-run` to preview reconcile
actions before applying.

**Pull exports leave out variable values and other secrets.** A pulled
manifest has no `variables` section; `shared_variables` lists names only.
Write-only fields (SMTP password, OAuth client secrets, custom domain TLS
material) are omitted too and stay unchanged unless set explicitly. To set
one from the manifest, use a `${ENV_VAR}` reference, which the CLI
interpolates from its environment before upload, never the value itself.

**A declared `variables` section is a second, competing source of truth for
variables — don't run both.** If a manifest declares `variables`, `config
deploy` fully syncs the project's variables to exactly that list, deleting
any variable not listed. That conflicts with `volcano variables deploy` /
`volcano cloud variables deploy` (see "Environment Variables" above) if both
are used for the same variables: whichever runs last wins, and `config
deploy` will delete anything only `variables deploy` set. Pick one path for
variables per project — typically `variables deploy` from `volcano.env` for
day-to-day secrets, and only add `variables` to the manifest if you want it
to be the single source of truth instead. `volcano deploy` refuses to run
when it finds both an env file and a manifest `variables` section; with the
manifest as the source, run `volcano deploy --no-env-file`.

**Partial example** (see the full schema at
`volcano-hosting/docs/projects/configuration.md` — it also covers `project`,
`databases`, `realtime`, `auth`, and `frontends`, omitted here for brevity):
```yaml
# volcano-config.yaml
version: 1                          # required — only version 1 is supported

variables:
  - name: STRIPE_SECRET_KEY
    value: ${STRIPE_SECRET_KEY}     # interpolated from the CLI environment

buckets:                            # bucket must already exist — never created here
  - name: avatars
    file_size_limit: 5242880        # optional — bytes
    allowed_mime_types: [image/jpeg, image/png]
    policies:                       # fully synced when declared — omit the key to leave untouched
      - name: owner-read-write
        operation: SELECT           # SELECT, INSERT, UPDATE, or DELETE
        definition: "auth.uid() IS NOT NULL"

functions:                          # function must already be deployed — never created here
  - name: notes-summary
    visibility: authenticated       # private (new functions' default), authenticated, or public
```

Schedulers require SUPERAGENT. On HOBBY, config deploy refuses a manifest
that declares `schedulers`, so add them only on a plan that includes them:
```yaml
# volcano-config.yaml
version: 1
functions:
  - name: notes-summary
    schedulers:                     # SUPERAGENT only; fully synced when declared
      - name: refresh-cache
        cron: "*/5 * * * *"
        enabled: true
        payload: { job: refresh }
```

**Hard rules:**
- `version: 1` is required. It's a schema version, not a Terraform-style
  state serial — it never needs bumping between deploys.
- Functions, frontends, databases, and buckets are **never created or
  deleted** through the manifest — they must already exist. A declared entry
  for a resource that doesn't exist is reported `skipped`; a deployed
  resource missing from a declared section is reported `missing`. Both are
  non-fatal warnings.
- Omitted sections/fields are left untouched (patch semantics). An **empty
  declared list** for a fully-synced collection — `variables`,
  `buckets[].policies`, `auth.providers.oauth`, `auth.email.templates`,
  `functions[].schedulers`, `frontends[].function_routes` — deletes everything
  currently in it. These are
  destructive by design; declaring the section at all means it's the source
  of truth.
- Each bucket policy `operation` must be `SELECT`, `INSERT`, `UPDATE`, or
  `DELETE`.
- `functions[].visibility` is `private`, `authenticated`, or `public`; see
  `volcano-functions` for who each level admits. Omit it to keep a function's
  current level. New functions start `private`, so declare `authenticated` for
  anything a signed-in user calls from the app. The deprecated `public: true`
  still means `public` and `public: false` means `authenticated`; write
  `visibility` instead, and never both with different meanings.
- Function visibility can also be set imperatively via
  `volcano cloud functions update <name> --visibility <level>`. `functions
  deploy` reads `volcano-config.yaml` for `kind` and function variables, but
  does **not** apply `visibility`: a new function deploys `private` until
  `volcano config deploy` (or `functions update`) sets its level. `volcano
  deploy` runs the config step after the functions, so one run deploys a new
  function and applies its visibility.

### Frontend function routes

`frontends[].function_routes` forwards paths of a frontend to functions on the
same origin. Declaring the list makes it the complete set: routes left out are
deleted, and `function_routes: []` deletes them all. Omit the key to leave a
frontend's routes alone.

```yaml
# volcano-config.yaml
version: 1
functions:
  - name: session
    visibility: public              # a routed function must be public
    invocation_mode: http           # and in HTTP mode
frontends:
  - name: web                       # frontend must already be deployed
    function_routes:
      - function: session
        path_prefix: /api/session   # starts with /, no trailing /
        strip_prefix: true          # optional, default false
```

- One deploy can make a function public and add its route, or delete a route
  and make the function private. A route to a function the same file leaves
  non-public fails the dry run, and nothing is applied.
- The longest matching prefix wins, and a frontend holds at most 64 routes.
- Anyone who can load the frontend can call a routed function. See
  `volcano-functions` for the cookie-session pattern it is meant for.

**There is no state file.** Don't invent one, and don't build a manual
rollback step for a failed `config deploy` — neither exists or is needed:
- Every `config deploy` (`--dry-run` included) diffs the manifest against the
  project's live configuration at request time. There's no cached snapshot of
  a prior apply to reconcile against.
- A failed apply still attempts every other planned change and reports
  `created` / `updated` / `deleted` / `unchanged` / `error` per entry;
  already-applied changes are **not** rolled back.
- Re-running `config deploy` with the *same* file is always safe: entries
  that already landed report `unchanged`; only entries that failed or still
  differ produce a new action. Fix the underlying issue (bad cron expression,
  plan-gated field, etc.) and re-run the same command — don't try to track or
  hand-edit applied state anywhere.

### Custom domains (cloud only)

A frontend serves a custom domain only once the account has verified that
hostname or a domain above it. Verify once per domain: every name below it is
then covered, in managed or BYOC TLS, in any of the account's projects. Attach
the hostname with `volcano cloud frontends domain create` (BYOC) or a manifest
`frontends[].custom_domain` entry. Verified domains belong to the account, so
`volcano cloud domains` needs a `volcano login` session; a project access token
is refused.

```bash
volcano cloud domains verify example.com   # fails and prints the TXT record to publish
# the user publishes the printed _volcano.example.com TXT record with their DNS provider
volcano cloud domains verify example.com   # succeeds once DNS serves the record
volcano cloud domains list
```

- Only the user can publish DNS records. Relay the exact record the CLI prints;
  never invent its value or reuse one from another domain or account.
- An unverified BYOC attach (`domain create`, or `tls.mode: byoc` in
  `config deploy`) fails and prints the record to publish. Verify, then re-run
  the same command.
- An unverified `tls.mode: managed` entry still deploys: Volcano holds the
  hostname and `volcano cloud frontends domain get <frontend>` lists the
  `_volcano` TXT record under "Verification records". Once the record is
  published, the same command lists the certificate validation CNAME to add.
- Keep the TXT record published. A domain another account verified stays
  theirs until their record is gone from DNS. Local mode serves no custom
  domains, so `volcano domains` refuses.

## Deploy & Local-Dev Workflow

### Local development
```sh
volcano start                       # start local Volcano stack (API, DB, functions runtime)
```
The local stack reads `volcano/volcano.env` for environment variables. Functions can be invoked locally through the local API endpoint.

### Local deploy
```sh
# Model B only — volcano deploy does not run your build.
npm run build:functions

# Deploy the whole project to the local stack.
volcano deploy --with-migrations
```

`volcano deploy` needs Volcano CLI 0.46.0 or later, and local
`volcano frontends` needs 0.45.0 or later; check the version
`volcano --version` printed. On an older CLI, `volcano deploy` fails with
`unknown command "deploy"`. Deploy the pieces the project has instead, in
this order, and suggest upgrading the CLI in `Next:`:

```sh
volcano variables deploy
volcano migrations deploy --all -d app     # only when migrations need applying
volcano functions deploy --all
volcano durable deploy --all               # only when the manifest declares kind: durable
# 0.45.x only, once per frontend (Next.js starter layout shown):
volcano frontends deploy --name web --path . --app-root web \
  --variable-scope scoped --variable <NEXT_PUBLIC_NAME>
volcano config deploy
```

`--path` is the directory to upload and `--app-root` the Next.js app inside
it. For the Next.js starter that is the project root (`.`) and `web`.

Below 0.45.0, `volcano frontends deploy` is an alias that uploads to the
selected **cloud** project, so never run it there; run the frontend with
`npm run dev` instead.

`volcano deploy` prints its plan, then runs these steps in order, skipping a
step the project has nothing for:

| Step | Reads | Same as |
|---|---|---|
| variables | `volcano/volcano.env`, or the manifest's `variables` sections | `volcano variables deploy` |
| migrations | `volcano/migrations/*.sql`, only with `--with-migrations` | `volcano migrations deploy --all -d app` |
| functions | standard functions in `volcano/functions/` | `volcano functions deploy --all` |
| durable | functions the manifest marks `kind: durable` | `volcano durable deploy --all` |
| frontends | frontends listed in `.volcano/source-layout.json` | `volcano frontends deploy --name web --path . --app-root web` for the Next.js starter (see below) |
| config | `volcano/volcano-config.yaml` | `volcano config deploy` |

Then it waits for every deployment it started, prints each result and the
frontend URLs, and exits non-zero if one failed. The order is the one the
platform needs: variables before the functions and frontends that read them,
schema before code that queries it, config after the functions whose
visibility it sets.

- **Inputs come only from flags.** `--env-file <file>` picks another env
  file, and `--no-env-file` deploys none, for a project whose manifest owns
  its variables. `-c <manifest>` (repeatable, applied in order) replaces the
  default manifest; the first one supplies function kinds, variable scopes,
  and frontend variable selections. `-d <database>` picks the migration target.
- **It refuses before changing anything** when an input file is broken or
  missing, when an env file and a manifest `variables` section are both
  present (see "volcano-config.yaml" above), when two manifests declare the
  same variable section, when `-d` comes without `--with-migrations`, when a
  manifest after the first declares `kind: durable` or a frontend's
  `variable_scope`/`variables`, or when `-c` leaves out
  `volcano/volcano-config.yaml` while it declares durable functions the first
  manifest doesn't.
- **A failed step stops the run.** The output names the steps that already ran
  and the commands that finish the rest. Rerun without `--with-migrations` if
  the migrations already applied.
- **Frontends come from `.volcano/source-layout.json`**, which `volcano init
  nextjs` creates from CLI 0.46.0 on. Each entry names a frontend, the
  directory to upload (`workspace`), and the Next.js app inside it
  (`app_root`). A project scaffolded earlier has none, and the plan shows
  `frontends  skipped: no .volcano/source-layout.json`; for the Next.js
  starter's layout, create it with:

  ```json
  {"version": 1, "frontends": [{"name": "web", "workspace": "", "app_root": "web"}]}
  ```

  `version: 1` is required. The upload skips
  what the root `.gitignore` lists and always leaves out `volcano/*.env` and
  the env file the run deployed. A frontend's manifest entry with
  `variable_scope: all`, or `scoped` with a `variables` list, decides which
  variables its build sees. Otherwise the build uses the selection the
  frontend already has, none when it's new. The CLI warns for `shared` or an
  entry missing one of the two fields, and a second deploy rebuilds with the
  selection the config step applied. It does **not** warn when the frontend
  has no `frontends:` entry, or an entry with neither field. The plain
  `volcano init nextjs` starter is in that case: it has a layout file but no
  manifest, so once its app reads `NEXT_PUBLIC_*` names, add a `frontends:`
  entry that selects them (see `volcano-nextjs`).
- **Frontend builds take minutes.** Pass `--no-frontends` when only function
  code, migrations, or config changed, and while `npm run dev` is the edit
  loop.
- **The wait lasts up to 30 minutes.** Run `volcano deploy` with a tool
  timeout that long, or in the background, and read its output until it
  exits. Don't swap in `--no-wait` and poll `get`: a frontend whose redeploy
  fails keeps serving its previous build and still shows `active`, so only
  the deploy's own wait reports the failure. Never rerun a deploy you stopped
  mid-wait with `--with-migrations`; the migrations already ran.

Redeploy one piece with its own command from the "Same as" column. For a
frontend whose deploy step failed, use the command `volcano deploy` prints,
which carries the name, path, `--app-root`, and variable selection. A build
that fails during the wait prints no such command: the output is the `✗`
line, `volcano frontends logs <name> --type build`, and
`N deployment(s) failed: frontend <name>`. Read the build logs, fix the
build, and rerun `volcano deploy` without `--with-migrations`. A bare
`volcano frontends deploy` names the frontend after the current directory and
creates a second one. In the cloud, prefix each command with `cloud`, except
migrations: `volcano cloud databases migration up --all -d <database>`.

To seed a manifest from an existing project, run `volcano config pull` once
before the first deploy. A pulled manifest has no `variables` section, so it
deploys next to `volcano/volcano.env`. Add a `variables` section only if the
manifest is meant to own variables; with both an env file and that section,
`volcano deploy` refuses.

### Cloud deploy (requires `volcano login` + `volcano use`)
```sh
npm run build:functions                    # Model B only
volcano cloud deploy --env-file volcano/cloud.env --with-migrations -d <database>
```

`volcano cloud deploy` runs the same steps against the selected cloud project.
`volcano/volcano.env` points at the local server, so the cloud deploy reads
`volcano/cloud.env`. It holds secrets, so before creating it make
`volcano/*.env` the last line of the project root's `.gitignore`; the last
matching rule wins, so no earlier `!` rule can re-include it:

```sh
[ "$(tail -n 1 .gitignore 2>/dev/null)" = 'volcano/*.env' ] || printf '\nvolcano/*.env\n' >> .gitignore
```

Projects scaffolded before CLI 0.46.0 ignore only `volcano.env`, and older CLIs
read only the root `.gitignore` when deciding what to upload with a frontend, so
a rule in `volcano/.gitignore` or a global ignore file keeps the file out of Git
but not out of the upload. Create it with every
variable the project needs
in the cloud: its own secrets and settings (`STRIPE_SECRET_KEY`, `GREETING`),
plus the cloud values of `VOLCANO_API_URL` (`https://api.volcano.dev`),
`VOLCANO_ANON_KEY`, and `VOLCANO_DATABASE` when functions read them, and their
`NEXT_PUBLIC_VOLCANO_*` copies for a Next.js frontend, whose build never sees
`VOLCANO_*` names. Get an anon key with `volcano projects keys anon list`. The
command refuses an env file that still holds the local server's keys or a
localhost `VOLCANO_API_URL`.

`--with-migrations` needs the cloud database to exist and be `active`;
otherwise the deploy stops at migrations after saving the variables. Create
it first, and repeat `get` until `Status` is `active`:

```sh
volcano cloud databases create <database> --region <region> --pg-version 16
volcano cloud databases get <database>
```

`-d` can be left out when the manifest's `databases:` section declares exactly
one. Migrations are not tracked, so `--with-migrations` applies every file to
the cloud database again; only pass it when the files are safe to re-run
there.

A project that deploys code from a connected Git repository is refused before
anything changes. Push to deploy code, and deploy the rest with:

```sh
volcano cloud variables deploy -f volcano/cloud.env
volcano cloud databases migration up --all -d <database>   # only when migrations need applying
volcano cloud config deploy
```

On a CLI older than 0.46.0, which has no `volcano cloud deploy`, run the same
steps one at a time: the three commands above, with
`volcano cloud functions deploy --all`, `volcano cloud durable deploy --all`,
and the frontend deploy before `config deploy`. Check first that
`volcano/cloud.env` is gitignored at the root (see above): these CLIs upload
whatever the root `.gitignore` doesn't exclude. Pass the frontend's variable
selection, or a new frontend builds with no variables:

```sh
volcano cloud frontends deploy --name web --path . --app-root web \
  --variable-scope scoped --variable NEXT_PUBLIC_VOLCANO_API_URL \
  --variable NEXT_PUBLIC_VOLCANO_ANON_KEY --variable NEXT_PUBLIC_VOLCANO_DATABASE
```

That is the Next.js starter's layout; for another, `--path` is the directory
to upload and `--app-root` the app inside it.

Cloud deploys need the user's explicit go-ahead (see `AGENTS.md`).

Deploying uploads local source, so it is a CLI action; the Volcano MCP server
has no deploy tool. An agent on MCP checks what a deploy produced with
`list_deployments` and `list_frontends`.

## Verify a local deploy (smoke test)

Deploying is not the finish line — exercise each function and assert on the
result (this is `AGENTS.md`'s "exercise what was built" step). Don't report
success from the deploy output alone.

**One-line smoke test — `volcano functions invoke`.** In local mode this runs the
function *as the pre-provisioned local user*, so `event.__volcano_auth` is
populated (id `11111111-…`, `clearwater@volcano.dev`). It's the fastest way to
confirm a function deployed, runs, and receives an auth context:

```sh
volcano functions invoke <name> --payload '{"title":"Buy milk"}' --json
```

Check the printed status/body. A missing dependency, a broken handler, or a
bad payload shape surfaces here immediately.

**Caveat — `auth.uid()` is NULL under this harness, so don't judge RLS/owner
logic by it.** `volcano functions invoke` is a credential-free local harness
(see its `--help`): it populates `event.__volcano_auth`, but it does **not**
establish a database auth session, so SQL `auth.uid()` returns null here. A
function that inserts an owner-scoped row through a `user_id` column defaulting
to `auth.uid()`, or whose table has RLS policies using `auth.uid()`, will fail
with `null value in column "user_id"` or return zero rows when invoked this way
— that is the **harness context, not a bug in the function**, and it is not a
reason to rewrite a correct handler (e.g. do NOT start hand-setting `user_id`
just to satisfy the CLI). Verify per-user / RLS behavior with the SDK recipe
below (a real signed-in user), where `auth.uid()` resolves — exactly as it does
for real callers in the browser/app and in the cloud.

**Multi-user / RLS checks — mint real users with the SDK.** The CLI invoke is
always that single local user, so it can't verify per-user isolation (that user
A cannot see user B's rows). For that, sign up throwaway users with the SDK and
invoke as each. Read `apiUrl`/`anonKey` from `volcano status`:

```js
// verify.mjs — run: node verify.mjs   (npm i @volcano.dev/sdk)
import { VolcanoAuth } from '@volcano.dev/sdk';

const apiUrl = 'http://localhost:8000';                 // from `volcano status`
const anonKey = 'ak-0000000000000000000000000000000000000000'; // from `volcano status`

async function tokenFor(email) {
  const auth = new VolcanoAuth({ apiUrl, anonKey });
  // Local dev has no email confirmation, so signInWhenAllowed returns a live
  // session directly; fall back to signIn if it doesn't.
  let { session } = await auth.signUp({ email, password: 'Smoke-Test-1!', signInWhenAllowed: true });
  if (!session) ({ session } = await auth.signIn({ email, password: 'Smoke-Test-1!' }));
  if (!session?.access_token) throw new Error(`no session for ${email}`);
  return session.access_token;
}

const token = await tokenFor(`smoke-${Date.now()}@example.com`);
const volcano = new VolcanoAuth({ apiUrl, anonKey, accessToken: token });
const { data, status, error } = await volcano.functions.invoke('<name>', { /* payload */ });
console.log({ status, data, error });
if (error || status < 200 || status >= 300) process.exit(1);
```

Easy wrong guesses to avoid (all verified against the SDK):
- The methods are `auth.signUp` / `auth.signIn` — there is no `signInWithPassword`.
- Auth responses are `{ user, session, error }` at the **top level**; the token
  is `session.access_token`, not `data.session.access_token`.
- `functions.invoke(name, payload)` returns `{ data, status, headers, version,
  error }` — check `error` and `status` before trusting `data`.
- Branch on `error.status === 404`, not on `status`: a refused or missing
  function never reaches an invocation, so `status` is `null`. A `404` for a
  function you deployed usually means its visibility refuses the caller, most
  often because it is `private`: it looks missing to everyone but service keys
  and schedulers, so check its `visibility` before redeploying. After widening
  a level, the SDK keeps answering a just-refused client `404` for about 30
  seconds. If the app should call it as the signed-in user, declare
  `visibility: authenticated` for it in `volcano-config.yaml` and run
  `volcano deploy` (or `volcano config deploy`). If it's meant for schedulers or server code only,
  keep it private and call it from there; never ship a service key to the
  browser.

## End-to-end checklist: build → local deploy → verify (am I done?)

The single "am I done?" gate for a full build-to-local-deploy task. Each phase
links the detail above or the domain skill that owns it; walk it top to bottom
and don't report success until every applicable box holds (skip a box only when
the project genuinely doesn't use that resource).

**Build**
- [ ] Non-deploying validation passed — typecheck / lint / unit tests, whatever the project has.
- [ ] Model B only: `npm run build:functions` produced `.js` files under `volcano/functions/` (native JS skips this).

**Local deploy** — see "Local deploy" above:
- [ ] `volcano start` — local stack up and `volcano status` healthy.
- [ ] `volcano deploy --with-migrations` (drop the flag when there are no migrations to apply), on CLI 0.46.0 or later, printed a plan whose steps cover what the build added: the env file, the migrations directory, `volcano/functions`, each durable function and frontend by name, and the manifest. `volcano functions list` shows every function.
- [ ] It exited zero with no `✗` lines, and each frontend printed a URL. (`unchanged` means the deploy had nothing new for that resource.)
- [ ] The manifest declares `visibility: authenticated` for every function the app calls as a signed-in user.

**Verify** — deploying is not the finish line (see "Verify a local deploy"):
- [ ] Each function smoke-tested with `volcano functions invoke <name>` — asserted on status/body, not read off the deploy output.
- [ ] Multi-user / RLS isolation confirmed with the SDK recipe if the app has per-user data.
- [ ] Static-correctness items from "Verification Checklist" below hold (layout, one-statement migrations, `auth.uid()`, `VOLCANO_DATABASE`, no `src/api/`).

The per-domain skills carry their own "Verification Checklist" for domain-specific
asserts — consult the ones the build touched: `volcano-functions`, `volcano-durable`,
`volcano-auth`, `volcano-database`, `volcano-storage`, `volcano-realtime`.

Cloud is out of scope here — never auto-deploy to cloud (see `AGENTS.md` safety model).

## Forbidden Patterns
- Do NOT create an `src/api/index.ts` route dispatcher or `openapi.yaml` — Volcano Functions deploy individually from `volcano/functions/`, not through a single entry point.
- Do NOT expect `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, or `VOLCANO_DATABASE` to be auto-injected — define them as project variables via `volcano variables deploy` (local) or `volcano cloud variables deploy -f volcano/cloud.env` (cloud).
- Do NOT use `VOLCANO_DB_NAME` — the canonical variable is `VOLCANO_DATABASE`.
- Do NOT use bare `uid()`, `email()`, `role()` — always use the `auth.` schema prefix: `auth.uid()`, `auth.email()`, `auth.role()`.
- Do NOT use `pg`/`pg-pool`/`DATABASE_URL` as a replacement for the SDK client — use `VOLCANO_DATABASE` and the SDK for all standard CRUD. Direct Postgres access is a discouraged, narrowly-scoped last resort ONLY for query-builder gaps that are provably impossible otherwise (joins/upserts/multi-statement transactions), NOT a general-purpose data layer or a reason to introduce an ORM as project architecture, and ONLY after rewriting `application_name` to `volcano_user_access:{user_id}` (raw `DATABASE_URL` bypasses RLS) — see `volcano-database`'s "Direct Postgres Access" section.
- Do NOT use `jsonwebtoken` or `bcryptjs` directly — Volcano Auth handles tokens and password hashing.
- Do NOT assume `__volcano_auth` is always present — it is injected only when the payload is an object and the request carries a valid token.
- Do NOT expect `volcano deploy` or `volcano functions deploy` to run your build — built `.js` files must exist under `volcano/functions/` on disk before deploy.
- Do NOT put more than one SQL statement in a migration file, and do NOT wrap one in `BEGIN; ... COMMIT;` — `volcano migrations deploy` executes each file as a single statement and rejects multi-statement bodies (`ERROR: Multiple statements are not supported`). Split a multi-step schema change into several sequentially-numbered single-statement files instead.
- Do NOT `require`/`import` an npm package (including `@volcano.dev/sdk`) from a native-JS (Model A) function without declaring it in a `package.json` — the packager never uploads `node_modules`, so an undeclared dependency fails at runtime with `Cannot find package`. Declare every imported package in a manifest so the runtime installs it.

## Verification Checklist
- Each deployed function was smoke-tested, not just deployed — `volcano functions invoke <name>` (runs as the local user) for a basic check, and the SDK recipe for multi-user/RLS isolation (see "Verify a local deploy").
- Function handlers exist under `volcano/functions/` and each exports `handler`.
- Shared code uses `_`-prefix directories (`_shared/`, `_lib/`).
- `volcano/migrations/` contains `.sql` files with numeric-prefix alphabetical naming, each with exactly one SQL statement (no `BEGIN`/`COMMIT`, no multiple `;`-terminated statements in one file).
- RLS policies use `auth.uid()` (with schema prefix), not bare `uid()`.
- `volcano-config.yaml` (if present) has `version: 1`. There is no minimum
  section requirement — a manifest can declare only `variables`, only
  `project`, etc.; omitted sections are left untouched, not an error.
- Environment variables are deployed via `volcano deploy` or `volcano variables deploy` (local), or `volcano cloud deploy --env-file volcano/cloud.env` or `volcano cloud variables deploy -f volcano/cloud.env` (cloud) — not assumed auto-injected.
- `VOLCANO_DATABASE` is used (not `VOLCANO_DB_NAME`).
- If using the build model: `npm run build:functions` produces `.js` files under `volcano/functions/` before deploy.
- Any npm package a native-JS function imports (e.g. `@volcano.dev/sdk`) is declared in a `volcano/functions/package.json` — an undeclared import fails at runtime with `Cannot find package`.
- No `src/api/`, `openapi.yaml`, `dist/index.js`, or `dev-server.mjs` in the project.

## Companion Skills
This skill defines the platform deploy contract. For domain-specific guidance:
- `volcano-sdk` — top-level orientation and skill router.
- `volcano-functions` — handler templates, invocation contract, user context, error handling.
- `volcano-durable` — checkpointed handlers, replay rules, executions, and cloud CLI lifecycle.
- `volcano-auth`, `volcano-database`, `volcano-storage`, `volcano-realtime` — per-domain APIs and patterns.
- `volcano-nextjs` — Next.js frontend patterns (AuthProvider, middleware, server actions).
- `volcano-uiux` — shared guidance for user-facing interfaces.
- `volcano-typescript` — canonical TypeScript type definitions.
- `volcano-error-handling` — reusable error-handling infrastructure.
