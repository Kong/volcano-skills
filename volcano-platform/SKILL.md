---
name: volcano-platform
description: Canonical project shape, Lambda runtime contract, build pipeline, and required canonical files for any Volcano-Hosting-deployable codebase. Self-contained for use without the volcano-standard scaffold.
---
# Volcano Platform Contract Skill

## Pairing
This skill is the **mandatory companion** to `volcano_sdk`. The two together cover everything needed to bootstrap a Volcano-Hosting-deployable project: `volcano_sdk` is the slim entrypoint + router that points at the relevant domain skills; this skill is the project/build contract. Neither is sufficient alone.

## Relationship to `volcano init`

`volcano init` creates a minimal CLI runtime skeleton that the CLI needs to operate:

```
volcano/                        # Volcano-managed project directory
volcano/.gitignore              # ignores volcano.env, .env.local, logs
volcano/volcano.env             # local environment variables
volcano/volcano.env.example     # env var documentation (committed)
volcano/volcano-config.yaml     # declarative config (functions, buckets)
volcano/functions/hello.js      # starter function handler
volcano/migrations/             # SQL migration files
volcano/migrations/README.md    # migration conventions
volcano/README.md               # next-step instructions
```

Other templates: `volcano init nextjs`, `volcano init python`, `volcano init ruby`.
Add `--example notes` (or `--example hello-world`) for a more complete demo.

This skill describes the **full application layout** to build on top of that skeleton: TypeScript Lambda backend, route dispatcher, shared client, build pipeline, migrations, and optional frontend. The two work together:

1. **`volcano init`** — creates the CLI runtime layout (directories + config + starter function)
2. **This skill** — guides building the application code within that layout

The `volcano/` directory created by `volcano init` maps to the project layout below as follows:
- `volcano/migrations/` is where SQL migration files go
- `volcano/functions/` is where serverless function handlers go
- `volcano/volcano.env` holds environment variables consumed by the SDK at runtime
- `volcano/volcano-config.yaml` is the declarative config for function visibility, buckets, etc.

**Important:** The application code structure described below (src/api/, src/shared/, package.json, tsconfig.json, openapi.yaml, etc.) is created by following this skill — not by `volcano init`. Do not expect `volcano init` to produce the full application layout.

## Role
Defines the project shape, Lambda runtime contract, build pipeline, and required canonical files for a Volcano-Hosting-deployable codebase. This skill is **self-contained**: any IDE or agentic harness with file-write and shell capability (Claude Code, Cursor, custom agents) can use it to bootstrap a working project from zero, without relying on a scaffold templating system.

## When to use
- Bootstrapping a new Volcano project from scratch.
- Verifying an existing project still satisfies platform requirements.
- Touching the Lambda entry point, build pipeline, shared types, route dispatcher, or migrations.
- Adding a new route, migration, or frontend page (the conventions live here).

## Project Layout (canonical)
```
.
├── openapi.yaml                # API contract (REQUIRED)
├── package.json                # Build/deps/scripts (REQUIRED)
├── tsconfig.json               # TS config (REQUIRED)
├── .env.example                # Env documentation
├── .gitignore
├── scripts/
│   └── dev-server.mjs          # Local HTTP→Lambda simulator (REQUIRED)
├── src/
│   ├── api/
│   │   ├── index.ts            # Lambda entry; exports `handler` (REQUIRED)
│   │   └── <feature>.ts        # Per-feature route handlers
│   ├── shared/
│   │   ├── http.ts             # Lambda event/response types + json() (REQUIRED)
│   │   ├── client.ts           # createClient(auth) factory (REQUIRED)
│   │   └── volcano-sdk.d.ts    # SDK type stub (REQUIRED until SDK ships its own .d.ts)
│   └── migrations/
│       ├── 20200101000000_init.sql           # Baseline (REQUIRED)
│       └── YYYYMMDDhhmmss_description.sql    # Subsequent migrations
├── web/                        # Optional Next.js frontend (only when explicitly requested)
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── lib/volcano.ts
│   ├── app/{layout,page}.tsx
│   ├── app/globals.css
│   └── types/volcano-sdk.d.ts
└── dist/
    └── index.js                # Build output, deployed to Lambda
```

**Hard rules:**
- Backend code lives ONLY under `src/api/` and `src/shared/`.
- Frontend code lives ONLY under `web/`. Never use `frontend/`.
- Migrations live ONLY under `src/migrations/` with the UTC timestamp filename format.
- Single Lambda backend entry point: `src/api/index.ts`.

## Lambda Runtime Contract
- **Runtime:** AWS Lambda, Node.js 20.
- **Module format:** ESM (`"type": "module"` in `package.json`).
- **Entry point:** `src/api/index.ts` MUST export `const handler` (named, not default).
- **Build output:** Single bundled file at `dist/index.js`.
- **Build command:** `esbuild src/api/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/index.js`.
- **Auth context:** Volcano hosting injects `event.__volcano_auth` when the request carries a valid Bearer token. Absent for unauthenticated requests.

### Event Shape (IN)
```ts
type LambdaEvent = {
  httpMethod: string;
  path: string;
  body?: string;
  queryStringParameters?: Record<string, string>;
  pathParameters?: Record<string, string>;
  __volcano_auth?: LambdaAuth;
};

type LambdaAuth = {
  user_id: string;
  email: string;
  role: string;
  project_id: string;
  access_token: string;
};
```

### Response Shape (OUT)
```ts
type ApiResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;   // STRING, not object — always JSON.stringify(...)
};
```

## Required Files — embed verbatim

### `package.json`
```json
{
  "name": "volcano-typescript-api",
  "version": "1.0.0",
  "description": "Volcano Hosting Lambda backend",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "npm run typecheck && esbuild src/api/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/index.js",
    "dev": "npm run build && node scripts/dev-server.mjs",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@volcano.dev/sdk": "latest"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.145",
    "@types/node": "^22.10.2",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.2"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```
Required scripts: `build`, `dev`, `typecheck`. Required keys: `name`, `version`, `scripts`, `dependencies`, `devDependencies`.

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true,
    "outDir": "dist",
    "lib": ["ES2022"],
    "types": ["node", "aws-lambda"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

### `openapi.yaml`
```yaml
openapi: 3.0.3
info:
  title: Volcano API
  description: REST API for Volcano Hosting
  version: 1.0.0
security:
  - BearerAuth: []
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
paths:
  /health:
    get:
      operationId: getHealth
      summary: Health check
      security: []
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                  timestamp:
                    type: string
x-pages: {}
```

**OpenAPI rules (validated by Volcano):**
- File MUST exist at repo root.
- Top-level `security: [{ BearerAuth: [] }]` defaults all endpoints to authenticated. Override per-operation with `security: []` for public routes.
- EVERY operation MUST have an `operationId` (camelCase).
- `x-pages` is an EXTENSION used for frontend page routes when `web/` is enabled. Each entry MUST be an object with `summary`, `file`, and `auth` fields. Do NOT add API routes to `x-pages` — those go in `paths`. Leave as `x-pages: {}` when there is no frontend.

### `src/api/index.ts` — Lambda entry + route dispatcher
```ts
import { json, type ApiResponse, type LambdaAuth, type LambdaEvent } from '../shared/http';

type HandlerFn = (event: LambdaEvent, auth?: LambdaAuth) => Promise<ApiResponse>;
type RouteMap = Record<string, Record<string, HandlerFn>>;

async function getHealth(_event: LambdaEvent): Promise<ApiResponse> {
  return json(200, { status: 'ok', timestamp: new Date().toISOString() });
}

const routes: RouteMap = {
  GET: {
    '/health': getHealth,
  },
};

const publicRoutes: Record<string, Record<string, boolean>> = {
  GET: {
    '/health': true,
  },
};

export const handler = async (event: LambdaEvent): Promise<ApiResponse> => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  const path = (event.path || '/').replace(/\/+$/, '') || '/';
  const auth = event.__volcano_auth;

  const methodRoutes = routes[method];
  if (!methodRoutes) {
    return json(405, { error: 'Method not allowed' });
  }

  const routeHandler = methodRoutes[path];
  if (!routeHandler) {
    return json(404, { error: 'Not found' });
  }

  if (!publicRoutes[method]?.[path] && !auth) {
    return json(401, { error: 'Unauthorized' });
  }

  try {
    return await routeHandler(event, auth);
  } catch (err) {
    console.error('Unhandled error:', err);
    const statusCode =
      typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    return json(statusCode, { error: statusCode === 412 ? (err as Error).message : 'Internal server error' });
  }
};
```

**Notes for the agent:**
- Route table is `routes[method][path] = handler`. Method-not-allowed → 405. Not-found → 404.
- The `publicRoutes` allowlist is what makes a route accessible without `event.__volcano_auth`. Anything NOT listed there returns 401 when auth is missing.
- The catch block has a deliberate "412 passthrough": when a downstream throws an error with `statusCode === 412`, the original `err.message` is returned to the caller (used by `requireEnv` in `src/shared/client.ts` so missing env vars surface clearly). Other thrown errors return generic `Internal server error`.

### `src/shared/http.ts` — types + json helper
```ts
export type LambdaAuth = {
  user_id: string;
  email: string;
  role: string;
  project_id: string;
  access_token: string;
};

export type LambdaEvent = {
  httpMethod: string;
  path: string;
  body?: string;
  queryStringParameters?: Record<string, string>;
  pathParameters?: Record<string, string>;
  __volcano_auth?: LambdaAuth;
};

export type ApiResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

export function json(statusCode: number, data: unknown): ApiResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}
```

### `src/shared/client.ts` — Volcano client factory
```ts
import { VolcanoAuth } from '@volcano.dev/sdk';
import type { LambdaAuth } from './http';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing ${name} for Volcano SDK`);
    (err as Error & { statusCode?: number }).statusCode = 412;
    throw err;
  }
  return value;
}

export function createClient(auth?: LambdaAuth): VolcanoAuth {
  const volcano = new VolcanoAuth({
    apiUrl: requireEnv('VOLCANO_API_URL'),
    anonKey: requireEnv('VOLCANO_ANON_KEY'),
    accessToken: auth?.access_token,
  });
  volcano.database(requireEnv('VOLCANO_DB_NAME'));
  return volcano;
}
```

`requireEnv` deliberately tags missing-env errors with `statusCode: 412` so the route dispatcher's catch block returns the descriptive message instead of a generic 500. This makes misconfiguration visible in dev.

### `src/shared/volcano-sdk.d.ts` — minimal SDK type stub
Lets `tsc --noEmit` succeed before `npm install` has run, and prevents type-noise when the SDK ships without complete .d.ts.
```ts
declare module '@volcano.dev/sdk' {
  export class VolcanoAuth {
    constructor(config: { apiUrl: string; anonKey: string; accessToken?: string });
    database(name: string): this;
    from(table: string): any;
    auth: any;
    storage: any;
    functions: any;
    realtime: any;
  }
}
```

### `scripts/dev-server.mjs` — local HTTP→Lambda simulator
```js
#!/usr/bin/env node

import { createServer } from 'node:http';
import { handler } from '../dist/index.js';

const port = Number(process.env.PORT || '3000');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function singleValueQuery(searchParams) {
  const out = {};
  for (const [key, value] of searchParams.entries()) {
    out[key] = value;
  }
  return out;
}

function requestHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      out[key] = value.join(',');
    } else if (value != null) {
      out[key] = String(value);
    }
  }
  return out;
}

function decodeBase64URL(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function parseJWTClaims(token) {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    return JSON.parse(decodeBase64URL(parts[1]));
  } catch {
    return null;
  }
}

function authFromHeaders(headers) {
  const authorization = headers.authorization || headers.Authorization;
  if (!authorization || typeof authorization !== 'string') {
    return undefined;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return undefined;
  }

  const accessToken = match[1].trim();
  if (!accessToken) {
    return undefined;
  }

  const claims = parseJWTClaims(accessToken) || {};
  return {
    access_token: accessToken,
    user_id: typeof claims.sub === 'string' ? claims.sub : 'debug-user',
    email: typeof claims.email === 'string' ? claims.email : '',
    role: typeof claims.role === 'string' && claims.role ? claims.role : 'authenticated',
    project_id: typeof claims.project_id === 'string' ? claims.project_id : '',
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const body = await readBody(req);
    const headers = requestHeaders(req.headers);

    const event = {
      httpMethod: (req.method || 'GET').toUpperCase(),
      path: url.pathname,
      body,
      headers,
      queryStringParameters: singleValueQuery(url.searchParams),
      __volcano_auth: authFromHeaders(headers),
    };

    const result = await handler(event);
    const statusCode = Number(result?.statusCode || 200);
    const responseHeaders = result?.headers || {};
    for (const [key, value] of Object.entries(responseHeaders)) {
      if (value != null) {
        res.setHeader(key, String(value));
      }
    }
    res.statusCode = statusCode;
    res.end(result?.body || '');
  } catch (err) {
    console.error('Dev server request failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Volcano dev server listening on http://127.0.0.1:${port}`);
});
```

The simulator reads a Bearer JWT, decodes the claims (no signature verification — local dev only), and populates `__volcano_auth` so the route dispatcher behaves the same way it will in production. PORT env var defaults to 3000.

### `src/migrations/20200101000000_init.sql` — baseline (REQUIRED)
```sql
-- Baseline migration for Volcano scaffold.
create extension if not exists pgcrypto;
```

### `.env.example`
```env
# Volcano SDK
VOLCANO_API_URL=https://api.volcano.dev
VOLCANO_ANON_KEY=your-anon-key
VOLCANO_DB_NAME=your-db-name

# Optional: service key for admin operations (bypasses RLS); SERVER-ONLY.
# VOLCANO_SERVICE_KEY=sk-your-service-key
```

### `.gitignore`
```
node_modules/
dist/
.env
.env.local
*.js.map
*.d.ts.map
.DS_Store
.vscode/
.idea/
*.log
deployment.zip
```

## Migration Conventions
- **Filename:** `YYYYMMDDhhmmss_description.sql` — UTC timestamp, snake_case description.
- **Location:** `src/migrations/` (no subdirectories).
- **Atomicity:** wrap multi-statement migrations in `BEGIN; ... COMMIT;`.
- **RLS helpers:** the Volcano runtime pre-creates `uid()`, `email()`, `role()` functions in the project schema — they read JWT claim session vars (`request.jwt.claim.sub`, etc.) set by the request pipeline. Use them directly in `USING` and `WITH CHECK` clauses.

### Canonical RLS migration shape
```sql
-- Migration: Enable Row Level Security
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY posts_select_published ON posts
    FOR SELECT
    USING (published = TRUE);

CREATE POLICY posts_select_own ON posts
    FOR SELECT
    USING (user_id = uid());

CREATE POLICY posts_insert_own ON posts
    FOR INSERT
    WITH CHECK (user_id = uid());

CREATE POLICY posts_update_own ON posts
    FOR UPDATE
    USING (user_id = uid());

CREATE POLICY posts_delete_own ON posts
    FOR DELETE
    USING (user_id = uid());
```

### User-table convention
When the project needs an application-side `users` table (profile data linked to Volcano auth):
```sql
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,  -- Matches Volcano auth user_id
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
The `id` column is the same UUID as `event.__volcano_auth.user_id` and matches `uid()` in RLS policies. Never assign your own ids — always use the auth user_id.

## Adding a New Route Handler

1. **Create the handler file** at `src/api/<feature>.ts`:
```ts
import { json, type ApiResponse, type LambdaAuth, type LambdaEvent } from '../shared/http';
import { createClient } from '../shared/client';

export async function listPosts(_event: LambdaEvent, auth?: LambdaAuth): Promise<ApiResponse> {
  const volcano = createClient(auth);
  const { data, error } = await volcano.from('posts').select('*');
  if (error) return json(500, { error: error.message });
  return json(200, { items: data ?? [] });
}
```

2. **Register in `src/api/index.ts`:**
```ts
import { listPosts } from './posts';

const routes: RouteMap = {
  GET: {
    '/health': getHealth,
    '/posts': listPosts,   // <-- add
  },
};
```

3. **Add to `openapi.yaml`** with an `operationId`:
```yaml
paths:
  /posts:
    get:
      operationId: listPosts
      summary: List posts
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items:
                      type: object
```

4. **If the route should be public** (no auth required), add it to the `publicRoutes` allowlist in `src/api/index.ts`:
```ts
const publicRoutes = {
  GET: {
    '/health': true,
    '/posts': true,
  },
};
```
Default behavior: routes NOT in `publicRoutes` return 401 when `event.__volcano_auth` is missing.

5. **Use extensionless TypeScript imports.** Write `from '../shared/http'`, never `from '../shared/http.ts'`.

## Optional Frontend (`web/`)
Materialize the `web/` tree only when the project actually needs a frontend.

### `web/package.json`
```json
{
  "name": "volcano-web",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --hostname 0.0.0.0 --port 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@volcano.dev/sdk": "latest",
    "next": "^15.3.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "typescript": "^5.7.2"
  }
}
```

### `web/next.config.ts`
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
```

### `web/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

### `web/lib/volcano.ts` — shared client (canonical pattern)
```ts
import { VolcanoAuth } from '@volcano.dev/sdk';

let volcano: VolcanoAuth | null = null;

export function getVolcano(): VolcanoAuth {
  if (!volcano) {
    volcano = new VolcanoAuth({
      apiUrl: process.env.NEXT_PUBLIC_VOLCANO_API_URL!,
      anonKey: process.env.NEXT_PUBLIC_VOLCANO_ANON_KEY!,
    });
    volcano.database(process.env.NEXT_PUBLIC_VOLCANO_DATABASE_NAME!);
  }
  return volcano;
}
```
Use `getVolcano()` everywhere; never `new VolcanoAuth(...)` in components.

### `web/types/volcano-sdk.d.ts` — type stub (mirrors backend)
```ts
declare module '@volcano.dev/sdk' {
  export type User = any;
  export type Session = any;

  export class VolcanoAuth {
    constructor(config: { apiUrl: string; anonKey: string; accessToken?: string });
    initialize(): Promise<any>;
    database(name: string): this;
    from(table: string): any;
    auth: any;
    storage: any;
    functions: any;
  }
}

declare module '@volcano.dev/sdk/next/middleware' {
  export function createServerClient(config: any): any;
  export function withAuth(request: any, client: any): Promise<any>;
  export function getTokenFromRequest(request: any): string | null;
}

declare module '@volcano.dev/sdk/realtime' {
  export class VolcanoRealtime {
    constructor(config: any);
    [key: string]: any;
  }
}
```

### `web/.env.local`
```env
NEXT_PUBLIC_VOLCANO_API_URL=https://api.yourproject.volcano.dev
NEXT_PUBLIC_VOLCANO_ANON_KEY=ak-your-anon-key
NEXT_PUBLIC_VOLCANO_DATABASE_NAME=your-database
```

### `openapi.yaml` `x-pages` — frontend page registration
For each frontend page, add an entry to `x-pages` in `openapi.yaml`:
```yaml
x-pages:
  /:
    summary: Home page
    file: web/app/page.tsx
    auth: false
  /dashboard:
    summary: User dashboard
    file: web/app/dashboard/page.tsx
    auth: true
```
Each entry is an object with `summary`, `file`, and `auth`. Do NOT put API routes here — those go in `paths`.

For deeper Next.js patterns (AuthProvider, middleware, server actions, OAuth), see the `volcano_nextjs` skill.

## Required Environment Variables

**Server-side (Lambda runtime, populated by Volcano hosting):**
- `VOLCANO_API_URL` — Volcano API endpoint
- `VOLCANO_ANON_KEY` — public anon key
- `VOLCANO_DB_NAME` — database name

**Optional, server-side only:**
- `VOLCANO_SERVICE_KEY` — service key (`sk-...`) for admin operations bypassing RLS. The SDK throws if a service key is used in browser code.

**Frontend (NEXT_PUBLIC_ prefix exposes to the browser):**
- `NEXT_PUBLIC_VOLCANO_API_URL`
- `NEXT_PUBLIC_VOLCANO_ANON_KEY`
- `NEXT_PUBLIC_VOLCANO_DATABASE_NAME`

The two namespaces are intentional. Never mix `NEXT_PUBLIC_*` into Lambda code or `VOLCANO_*` (without prefix) into browser code.

## Build, Dev, Deploy Workflow
- `npm install` — install deps (run once after bootstrap).
- `npm run typecheck` — TS validation only (no emit).
- `npm run build` — typecheck + esbuild bundle to `dist/index.js`.
- `npm run dev` — build + start dev server on `:3000`.
- `npm run clean` — remove `dist/`.

The deploy artifact is `dist/index.js`. Volcano hosting picks it up as the Lambda function source. Migrations under `src/migrations/` are applied to the project database in filename order.

### Bootstrap sequence (zero-to-deployable)
For an external harness (e.g., Claude Code) starting from an empty directory:
1. Run `volcano init` to create the CLI runtime skeleton (`volcano/` dirs, `volcano.env`, `volcano-config.yaml`).
2. Write `package.json`, `tsconfig.json`, `openapi.yaml`, `.env.example`, `.gitignore`.
3. Write `src/api/index.ts`, `src/shared/http.ts`, `src/shared/client.ts`, `src/shared/volcano-sdk.d.ts`.
4. Write `scripts/dev-server.mjs`.
5. Write `src/migrations/20200101000000_init.sql`.
6. (If frontend requested) Write the `web/` tree with `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/lib/volcano.ts`, `web/app/layout.tsx`, `web/app/page.tsx`, `web/app/globals.css`, `web/types/volcano-sdk.d.ts`.
7. Run `npm install` in repo root (and `cd web && npm install` if web/).
8. Run `npm run build` — must produce `dist/index.js` cleanly.
9. Run `node scripts/dev-server.mjs` and verify `curl http://localhost:3000/health` returns `{"status":"ok",...}`.
10. Implement requested features by adding files under `src/api/`, registering in `routes`, and updating `openapi.yaml`.

## Forbidden Patterns
- Do NOT use `default` export from `src/api/index.ts` — must be `export const handler`.
- Do NOT use CommonJS (`module.exports`, `require`) in Lambda code — `"type": "module"` enforces ESM.
- Do NOT import from `pg`, `pg-pool`, or any direct Postgres driver — all data access goes through the Volcano SDK.
- Do NOT use `DATABASE_URL` env var — use `VOLCANO_DB_NAME` and the SDK.
- Do NOT use `jsonwebtoken` or `bcryptjs` directly — Volcano Auth handles tokens and password hashing.
- Do NOT put backend code outside `src/api/` and `src/shared/`.
- Do NOT put frontend code anywhere except `web/`. Never `frontend/`.
- Do NOT add API routes to `x-pages` (frontend-only) or frontend pages to `paths` (API-only).
- Do NOT use `.ts`/`.tsx` extensions in TypeScript imports — extensionless relative imports only (`from '../shared/http'`).
- Do NOT skip `operationId` on any OpenAPI operation — validation rejects it.
- Do NOT mix `NEXT_PUBLIC_*` env vars into Lambda/server code, or `VOLCANO_*` (un-prefixed) into browser code.
- Do NOT replace the route dispatcher with a third-party framework (Express, Hono, etc.) — the canonical dispatcher is what platform tooling expects.
- Do NOT skip the baseline `20200101000000_init.sql` migration — `pgcrypto` is assumed available downstream.

## Verification Checklist
- `package.json` has `"type": "module"`, `"main": "dist/index.js"`, and the `build`/`dev`/`typecheck` scripts.
- `src/api/index.ts` exports `handler` (named, not default) and routes through the dispatcher pattern.
- `openapi.yaml` exists at root with `BearerAuth` security scheme; every operation has an `operationId`; `x-pages` is present (`{}` if no frontend).
- `src/shared/http.ts` defines `LambdaEvent`, `LambdaAuth`, `ApiResponse`, and the `json()` helper.
- `src/shared/client.ts` exports `createClient(auth)` and uses `requireEnv` for the three Volcano env vars.
- `scripts/dev-server.mjs` exists and imports `handler` from `../dist/index.js`.
- `src/migrations/20200101000000_init.sql` exists and creates the `pgcrypto` extension.
- All TypeScript imports are extensionless.
- `npm run build` produces `dist/index.js` without errors.
- `node scripts/dev-server.mjs` listens on `:3000`; `GET /health` returns `200 {"status":"ok",...}`.
- (If web/) `web/lib/volcano.ts` exports `getVolcano()` using `NEXT_PUBLIC_*` env vars; pages import from there, not `new VolcanoAuth(...)` directly.

## Companion Skills
This skill defines the platform contract. For SDK-level guidance, invoke the relevant domain skill:
- `volcano_sdk` — top-level orientation
- `volcano_auth`, `volcano_database`, `volcano_functions`, `volcano_storage`, `volcano_realtime`, `volcano_nextjs` — per-domain APIs and patterns
