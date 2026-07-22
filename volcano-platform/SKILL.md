---
name: volcano-platform
description: "Canonical Volcano project shape and deploy contract: the volcano/functions/ model, migrations, volcano-config.yaml, env vars, shared-code conventions, and the build/deploy workflow."
---
# Volcano Platform Contract Skill

## Role & Pairing
Defines the canonical project shape and deploy contract for any Volcano-Hosting-deployable codebase. Covers the `volcano/functions/` deployment model, migrations, `volcano-config.yaml`, environment variables, shared-code conventions, and the build/deploy workflow.

**Pair with:**
- `volcano_sdk` — the SDK entrypoint and skill router.
- `volcano_functions` — function-writing internals: handler templates, invocation contract, user-context patterns, error handling.

This skill focuses on **project shape and deploy mechanics**, not on how to write individual function handlers.

## Relationship to `volcano init`

`volcano init` (from the Volcano CLI) creates a minimal runtime skeleton in a `volcano/` directory:

```
volcano/                        # Volcano-managed project directory
volcano/.gitignore              # ignores volcano.env, .env.local, logs
volcano/volcano.env             # local environment variables (gitignored)
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

Note: `volcano-config.yaml` is created only by the `javascript` template, not by the base scaffold. You can also create it manually at `volcano/volcano-config.yaml`.

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
│   ├── volcano.env                 # local env vars (gitignored)
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

### Handler signature
```js
exports.handler = async (event) => {
  const auth = event && typeof event === 'object' ? event.__volcano_auth : undefined;
  // ...
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
```

For detailed handler templates, invocation patterns, and user-context guidance, see the `volcano_functions` skill.

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

For browser-side client setup, see the `volcano_nextjs` skill.

## Environment Variables

Functions receive **only user-defined project variables**. Volcano does **not** auto-inject `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, or `VOLCANO_DATABASE` into the function runtime. You must define these as project variables.

**Deploy variables:**
```sh
volcano variables deploy
```
This reads from `volcano/volcano.env` (or a specified file) and sets project-scoped environment variables that all functions in the project receive at runtime.

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

**`DATABASE_URL` is auto-injected** (unlike `VOLCANO_API_URL`/`VOLCANO_ANON_KEY`/`VOLCANO_DATABASE` above) and carries full admin access (`application_name=volcano_full_access`) by default. Always use the SDK client (`volcano.from(...)`), not `DATABASE_URL`. Direct Postgres access is a discouraged last resort with untested, unbounded surface area — see the `volcano_database` skill's "Direct Postgres Access" section before ever reaching for it.

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
custom domains. Located at `volcano/volcano-config.yaml` or root
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

**Pull exports include plaintext variable values, but not other secrets.**
Write-only fields (SMTP password, OAuth client secrets, custom domain TLS
material) are omitted from the export and stay unchanged unless set
explicitly, but `variables[].value` **is** included in the clear. Never
commit a pulled manifest as-is: replace secret values with `${ENV_VAR}`
references (interpolated from the CLI environment before upload) before it
touches version control.

**A declared `variables` section is a second, competing source of truth for
variables — don't run both.** If a manifest declares `variables`, `config
deploy` fully syncs the project's variables to exactly that list, deleting
any variable not listed. That conflicts with `volcano variables deploy` /
`volcano cloud variables deploy` (see "Environment Variables" above) if both
are used for the same variables: whichever runs last wins, and `config
deploy` will delete anything only `variables deploy` set. Pick one path for
variables per project — typically `variables deploy` from `volcano.env` for
day-to-day secrets, and only add `variables` to the manifest if you want it
to be the single source of truth instead.

**Partial example** (see the full schema at
`volcano-hosting/docs/projects/configuration.md` — it also covers `project`,
`databases`, `realtime`, `auth`, and `frontends`, omitted here for brevity):
```yaml
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
    public: false                   # required — boolean
    schedulers:                     # fully synced when declared
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
  `functions[].schedulers` — deletes everything currently in it. These are
  destructive by design; declaring the section at all means it's the source
  of truth.
- Each bucket policy `operation` must be `SELECT`, `INSERT`, `UPDATE`, or
  `DELETE`. Each declared function needs `public` set (boolean).
- Function visibility can also be set imperatively via
  `volcano cloud functions update --public` / `--private`; `functions deploy`
  itself does **not** read `volcano-config.yaml`.

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

## Deploy & Local-Dev Workflow

### Local development
```sh
volcano start                       # start local Volcano stack (API, DB, functions runtime)
```
The local stack reads `volcano/volcano.env` for environment variables. Functions can be invoked locally through the local API endpoint.

### Local deploy sequence
```sh
# 0. (optional, only if volcano-config.yaml doesn't exist yet) seed it from
#    the current project state — pull refuses to overwrite an existing file
#    without --force, so skip this if a manifest is already present (for
#    example the one `volcano init javascript` scaffolds).
#    WARNING: a pulled manifest contains plaintext variable values AND a
#    `variables` section. Before step 4, (a) replace secret values with
#    ${ENV_VAR} references — never commit a pulled manifest as-is — and
#    (b) delete the `variables` section unless you intend the manifest to be
#    the single source of truth, otherwise step 4 (`config deploy`) fully
#    syncs variables to that list and deletes anything only step 2
#    (`variables deploy`) set. See the "volcano-config.yaml" warnings above.
volcano config pull

# 1. Build function output (Model B only — skip for native JS)
npm run build:functions

# 2. Deploy environment variables
volcano variables deploy

# 3. Deploy functions from volcano/functions/
volcano functions deploy --all

# 4. Reconcile all declared config sections (project, databases, variables,
#    buckets/policies, realtime, auth, function visibility/schedulers, frontends)
volcano config deploy

# 5. Apply database migrations
volcano migrations deploy --all -d app
```

### Cloud deploy (requires `volcano login` + `volcano use`)
```sh
# 0. (optional, only if volcano-config.yaml doesn't exist yet) seed it from
#    the current project state — pull refuses to overwrite an existing file
#    without --force, so skip this if a manifest is already present (for
#    example the one `volcano init javascript` scaffolds).
#    WARNING: a pulled manifest contains plaintext variable values AND a
#    `variables` section. Before step 4, (a) replace secret values with
#    ${ENV_VAR} references — never commit a pulled manifest as-is — and
#    (b) delete the `variables` section unless you intend the manifest to be
#    the single source of truth, otherwise step 4 (`cloud config deploy`)
#    fully syncs variables to that list and deletes anything only step 2
#    (`cloud variables deploy`) set — on cloud this is production data loss.
#    See the "volcano-config.yaml" warnings above.
volcano cloud config pull

# 1. Build function output (Model B only — skip for native JS)
npm run build:functions

# 2. Deploy environment variables
volcano cloud variables deploy

# 3. Deploy functions from volcano/functions/
volcano cloud functions deploy --all

# 4. Reconcile all declared config sections (project, databases, variables,
#    buckets/policies, realtime, auth, function visibility/schedulers, frontends)
volcano cloud config deploy

# 5. Apply database migrations
volcano cloud migrations deploy --all -d app
```

**Order matters:** variables before functions (so handlers have env vars on first deploy), config after functions (so visibility targets exist), migrations last (schema is ready for runtime queries). Note that step 4 (`config deploy`) runs *after* step 2 (`variables deploy`): if the manifest declares a `variables` section, step 4 wins and will overwrite or delete variables set by step 2 — keep `variables` out of the manifest unless it is the single source of truth (see "volcano-config.yaml" above).

## Forbidden Patterns
- Do NOT create an `src/api/index.ts` route dispatcher or `openapi.yaml` — Volcano Functions deploy individually from `volcano/functions/`, not through a single entry point.
- Do NOT expect `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, or `VOLCANO_DATABASE` to be auto-injected — define them as project variables via `volcano variables deploy` (local) or `volcano cloud variables deploy` (cloud).
- Do NOT use `VOLCANO_DB_NAME` — the canonical variable is `VOLCANO_DATABASE`.
- Do NOT use bare `uid()`, `email()`, `role()` — always use the `auth.` schema prefix: `auth.uid()`, `auth.email()`, `auth.role()`.
- Do NOT use `pg`/`pg-pool`/`DATABASE_URL` as a replacement for the SDK client — use `VOLCANO_DATABASE` and the SDK for all standard CRUD. Direct Postgres access is a discouraged, narrowly-scoped last resort ONLY for query-builder gaps that are provably impossible otherwise (joins/upserts/multi-statement transactions), NOT a general-purpose data layer or a reason to introduce an ORM as project architecture, and ONLY after rewriting `application_name` to `volcano_user_access:{user_id}` (raw `DATABASE_URL` bypasses RLS) — see `volcano_database`'s "Direct Postgres Access" section.
- Do NOT use `jsonwebtoken` or `bcryptjs` directly — Volcano Auth handles tokens and password hashing.
- Do NOT assume `__volcano_auth` is always present — it is injected only when the payload is an object and the request carries a valid token.
- Do NOT expect `volcano functions deploy` to run your build — built `.js` files must exist under `volcano/functions/` on disk before deploy.
- Do NOT put more than one SQL statement in a migration file, and do NOT wrap one in `BEGIN; ... COMMIT;` — `volcano migrations deploy` executes each file as a single statement and rejects multi-statement bodies (`ERROR: Multiple statements are not supported`). Split a multi-step schema change into several sequentially-numbered single-statement files instead.

## Verification Checklist
- Function handlers exist under `volcano/functions/` and each exports `handler`.
- Shared code uses `_`-prefix directories (`_shared/`, `_lib/`).
- `volcano/migrations/` contains `.sql` files with numeric-prefix alphabetical naming, each with exactly one SQL statement (no `BEGIN`/`COMMIT`, no multiple `;`-terminated statements in one file).
- RLS policies use `auth.uid()` (with schema prefix), not bare `uid()`.
- `volcano-config.yaml` (if present) has `version: 1`. There is no minimum
  section requirement — a manifest can declare only `variables`, only
  `project`, etc.; omitted sections are left untouched, not an error.
- Environment variables are deployed via `volcano variables deploy` (local) or `volcano cloud variables deploy` (cloud) — not assumed auto-injected.
- `VOLCANO_DATABASE` is used (not `VOLCANO_DB_NAME`).
- If using the build model: `npm run build:functions` produces `.js` files under `volcano/functions/` before deploy.
- No `src/api/`, `openapi.yaml`, `dist/index.js`, or `dev-server.mjs` in the project.

## Companion Skills
This skill defines the platform deploy contract. For domain-specific guidance:
- `volcano_sdk` — top-level orientation and skill router.
- `volcano_functions` — handler templates, invocation contract, user context, error handling.
- `volcano_auth`, `volcano_database`, `volcano_storage`, `volcano_realtime` — per-domain APIs and patterns.
- `volcano_nextjs` — Next.js frontend patterns (AuthProvider, middleware, server actions).
- `volcano_typescript` — canonical TypeScript type definitions.
- `volcano_error_handling` — reusable error-handling infrastructure.
