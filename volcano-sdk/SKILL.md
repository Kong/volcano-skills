---
name: volcano-sdk
description: Entrypoint and router for Volcano SDK work. Pair with volcano_platform (mandatory). Indicates which volcano_* domain skill (auth/database/functions/storage/realtime/nextjs/typescript/error_handling) to invoke for each task.
---
# Volcano SDK Entrypoint

## Role
This skill is the **entrypoint and router** for Volcano SDK work. It is intentionally slim: it tells you the mandatory rules that apply to every Volcano build, and which OTHER volcano_* skill to invoke based on the task at hand. Don't try to do deep work from this skill alone — invoke the relevant domain skill(s) first.

## Mandatory Pairing — `volcano_platform`
**Always read `volcano_platform` alongside this skill.** It covers the canonical project shape, function deployment model (`volcano/functions/`), migrations, `volcano-config.yaml`, environment variables, shared-code conventions, and the deploy workflow. Without `volcano_platform` you cannot produce a deployable codebase.

If `volcano_platform` content is not visible in your context, invoke it first:
`action: "invoke", skill_id: "volcano_platform"`.

**Note:** `volcano init` creates a minimal runtime skeleton (`volcano/` dir with env files, migrations, and — for language templates — a starter handler and config). Build on top of that skeleton by following `volcano_platform`. Do not expect `volcano init` to produce the complete project structure.

## Mandatory Usage (volcano-standard template)
When building on the Volcano platform you MUST use:
- **Volcano Auth** (`volcano.auth.*`) for ALL authentication and user identity.
- **Volcano Database query builder** (`volcano.from('table').select()`) for persistent storage, with RLS policies. Exception: joins/aggregations/multi-statement transactions/ORMs go through direct Postgres access inside Functions instead — see `volcano_database`.
- **Volcano Functions** for ALL privileged or secret-bearing server-side logic.
- **Volcano Storage** (`volcano.storage.*`) for ALL file operations.
- **Volcano Realtime** (`VolcanoRealtime`) for ALL live update patterns.

Do NOT implement custom alternatives — no custom JWT auth, no ad-hoc database layers, no hand-rolled file storage, no DIY WebSocket multiplexers.

## Skill Router — pick the skill(s) you need

| Task signal | Invoke skill | What it covers |
|---|---|---|
| Sign up / sign in / sign out, OAuth, sessions, anonymous users, password reset, email verification, multi-device sessions | `volcano_auth` | Full auth API surface, lifecycle, common-error catalog |
| Database queries (`volcano.from(...)`), RLS policies, CRUD, filters/ordering/pagination, mutations, `.single()` modifier | `volcano_database` | Query builder + every operator + RLS pattern + limitations (no joins / upserts / multi-statement tx) |
| Server-side handlers (`event.__volcano_auth`), `volcano.functions.invoke(...)`, secrets, third-party APIs, orchestration | `volcano_functions` | Invocation contract `{data, status, headers, version, error}`, Volcano Functions response shape, handler templates |
| Upload / download / list / remove, buckets, paths, public/private toggle, resumable uploads | `volcano_storage` | Full storage API + access policies + resumable protocol + limits |
| Postgres changes, broadcast, presence, WebSocket connections, browser CORS for realtime, custom `webSocket` constructor | `volcano_realtime` | All three channel types + lifecycle + Browser Origins/CORS gotcha + `accessToken` vs `getToken` decision |
| Next.js: client components, AuthProvider, middleware (`createServerClient`/`withAuth`), App/Pages router API routes, server actions, Cookie Sync (required for Server Actions) | `volcano_nextjs` | Cross-cutting Next.js patterns including the cookie-sync prerequisite |
| TypeScript types — `User`, `Session`, `AuthResponse`, `QueryBuilder<T>`, `StorageObject`, `PostgresChange`, `PresenceState`, `JsonValue`, etc. | `volcano_typescript` | Canonical type definitions for every SDK surface |
| Loading/error/data state, `useApiCall<T>` hook, `fetchWithRetry` with backoff, centralized `handleApiError` dispatcher | `volcano_error_handling` | Reusable error-handling INFRASTRUCTURE (per-domain error MESSAGES live in the relevant domain skill) |
| Project shape, function deployment model, migrations, `volcano-config.yaml`, env vars, deploy workflow, RLS helpers (`auth.uid()`/`auth.email()`/`auth.role()`) | `volcano_platform` | Already mandatory — see "Mandatory Pairing" above |

### How to use the router
1. Read the user's request and identify which task signal(s) match.
2. Invoke each matching skill via `action: "invoke", skill_id: "..."` BEFORE writing implementation code. It's normal to invoke 2-4 skills for a single task (e.g., a "user dashboard" might need `volcano_auth` + `volcano_database` + `volcano_nextjs`).
3. If the task is purely about project setup (no app features yet), `volcano_platform` alone is enough.
4. If you can't decide between two domain skills, invoke both — token cost is much lower than implementing the wrong pattern.

## Universal Response Pattern
Every SDK method returns `{ data, error }` (auth methods also include `user`/`session`; functions add `status`/`headers`/`version`). Always check `error` before consuming `data`. Do NOT wrap SDK calls in try/catch expecting throws — the only SDK method that throws is `await channel.subscribe()` for realtime.

```ts
const { data, error } = await volcano.from('posts').select('*');
if (error) {
  // dispatch via handleApiError (see volcano_error_handling)
  return;
}
// data is safe to use
```

For comprehensive error-handling infrastructure (centralized dispatcher, React hooks, retry with backoff), invoke `volcano_error_handling`.

## Forbidden Patterns (always)
These apply to every Volcano build, regardless of which domain skills are loaded:

- Do NOT use `jsonwebtoken` directly — use Volcano Auth.
- Do NOT use `bcryptjs` directly — use Volcano Auth's password handling.
- Do NOT default to `pg`/`pg-pool`/`DATABASE_URL` for standard CRUD — use `volcano.from(...)` (with `VOLCANO_DATABASE`) instead. Direct Postgres access is a supported exception ONLY inside Functions for joins/aggregations/transactions/ORMs, and ONLY with `application_name` rewritten to `volcano_user_access:{user_id}` (the raw injected `DATABASE_URL` bypasses RLS) — see `volcano_database`'s "Direct Postgres Access" section.
- Do NOT mix `NEXT_PUBLIC_*` env vars into function/server code, or `VOLCANO_*` (un-prefixed) into browser code.
- Do NOT place service keys (`sk-*`) in browser code — the SDK throws if you do.
- Do NOT expect `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, or `VOLCANO_DATABASE` to be auto-injected into functions — deploy them via `volcano variables deploy` (local) or `volcano cloud variables deploy` (cloud).
- Do NOT skip `await volcano.initialize()` before user-scoped flows in the browser.
- Do NOT use `.ts`/`.tsx` extensions in TypeScript imports — extensionless relative imports only.
- Do NOT use bare `uid()` in RLS policies — always use the schema-qualified `auth.uid()`.

For the deeper context behind any of these (why and what to do instead), the relevant domain skill or `volcano_platform` covers it.

## Output Requirements
At the end of each Volcano build response:
1. **Summarize affected domains** — which volcano_* areas were touched (auth/database/functions/storage/realtime/nextjs).
2. **Summarize dependency / env / init changes** — new packages, env vars added, init order changes.
3. **Report validation results** — what you ran (`npm run typecheck`, `npm run build:functions`, local stack health check), what passed, what couldn't be run, and any remaining risk.

## Companion Skills (full inventory)
Always available; invoke as needed:
- `volcano_platform` — mandatory pairing.
- `volcano_auth`, `volcano_database`, `volcano_functions`, `volcano_storage`, `volcano_realtime`, `volcano_nextjs` — domain skills.
- `volcano_typescript` — canonical type definitions.
- `volcano_error_handling` — reusable error-handling infrastructure.

## Optional Fallback Reference
