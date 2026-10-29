---
name: volcano-functions
description: Use for Volcano server-side Functions and privileged or secret-bearing logic, including function invocation and visibility, functions served under a frontend path, generators such as QR codes or PDFs, outbound third-party APIs, orchestration, scheduled processing, and file or image processing.
---
# Volcano Functions Skill

## Role
Use Volcano Functions for privileged, secret-bearing, or orchestration-heavy backend logic. This skill is self-contained: invocation, response shape, handler templates, env, and error handling are embedded.

## Workflow
1. Confirm the operation belongs in Functions (privileged/secrets/heavy orchestration). If it's a plain RLS-protected query, do it client-side via Volcano Database instead.
2. Implement invocation with explicit success and failure handling.
3. Enforce user-context assumptions where authorization matters.
4. Route persistent data access through the Volcano Database query-builder pattern. Only when a specific query-builder gap (joins/upserts/multi-statement transactions) is provably impossible otherwise, fall back to direct Postgres access as a discouraged, narrowly-scoped last resort (see `volcano-database`'s "Direct Postgres Access" section — requires the `application_name=volcano_user_access:{user_id}` rewrite to stay RLS-safe).
5. Validate the client-vs-function boundary.

## Invocation Contract
Every invocation returns `{ data, status, headers, version, error }`.
- `status` — HTTP status from the function response.
- `headers` — response headers.
- `version` — value of `X-Volcano-Version` (`<version>` in production, `<env>-<version>` otherwise).
- `error` — present on transport/runtime failure or non-2xx status; check this before consuming `data`.

### Basic
```ts
const { data, status, version, error } = await volcano.functions.invoke('send-welcome-email', {
  template: 'welcome',
  recipientId: user.id,
});
if (error) {
  console.error('Function failed:', error.message);
  return;
}
```

### Typed payload + response
```ts
interface DashboardStats { totalUsers: number; activeToday: number; revenue: number; }
const { data, status, headers, version, error } = await volcano.functions.invoke<
  { timeframe: string },
  DashboardStats
>('get-dashboard-stats', { timeframe: 'last-30-days' });
```

### No payload
```ts
const { data, status, version, error } = await volcano.functions.invoke('health-check');
```

## User Context
Functions automatically receive the caller's identity in `event.__volcano_auth`:
- `auth.user_id` — the authenticated user's id.
- `auth.email` — the user's email.
- `auth.role` — the user's role (if set).
- `auth.project_id` — the project this user is acting in.
- `auth.access_token` — server-injected bearer token; use to call other Volcano APIs on the user's behalf.

If `__volcano_auth` is absent, the request is unauthenticated.

## Who Can Invoke a Function

Each function has a visibility level. **New functions are `private`**, so a
browser app's `volcano.functions.invoke(...)` gets `404`, as if the function
didn't exist, until you choose a wider level. `invoke` resolves the name
first, and that lookup answers `404` to any caller the level refuses, so an
anon key on an `authenticated` function also gets `404` by name. Only a
direct invoke by function id answers it `403`.

| Visibility | Who can invoke it | Use it for |
|---|---|---|
| `private` (default) | Service keys and schedulers | Scheduled jobs, admin tasks, functions only your server code calls |
| `authenticated` | Also the project's signed-in users, including anonymous sign-ins | Functions your app calls on behalf of a signed-in user |
| `public` | Also anon keys with `functions.invoke`, and frontend function routes | Code that must work before sign-in: public forms, webhooks, a session endpoint behind a frontend route |

- Pick the narrowest level that works. Most app functions are `authenticated`.
- `authenticated` still lets any signed-in user call the function. Check
  `__volcano_auth` and enforce ownership in the handler or through RLS.
- A `public` function is reachable without a user. Validate every input and
  never trust identity claims from the request body.
- Set the level in `volcano-config.yaml` (see `volcano-platform`) or with the
  CLI. Changing a level is a permission change: ask the user before doing it
  on a cloud project.

```yaml
# volcano-config.yaml
version: 1
functions:
  - name: get-my-posts
    visibility: authenticated
  - name: nightly-report
    visibility: private
```

```sh
volcano functions update get-my-posts --visibility authenticated          # local
volcano cloud functions update get-my-posts --visibility authenticated    # cloud
```

`--private` is no longer accepted: it used to mean what `authenticated` means
now. Write the level you want.

### Serve a function under a frontend path

A frontend function route forwards every request under a path of your
frontend, such as `/api/session`, to an HTTP-mode function. The browser stays
on the frontend's origin, so the function can keep a session in `HttpOnly`
cookies and the page never handles an access token.

```yaml
# volcano-config.yaml
version: 1
functions:
  - name: session
    visibility: public          # routes require public
    invocation_mode: http
frontends:
  - name: web
    function_routes:
      - function: session
        path_prefix: /api/session
        strip_prefix: true      # GET /api/session/me reaches the function as /me
```

- The target must be `public` with `invocation_mode: http`. Volcano refuses
  the route otherwise, and refuses to make a routed function non-public.
- A routed request carries no Volcano identity: `__volcano_auth` is never set,
  even when the visitor sends a valid token. The function authenticates its
  callers itself, typically by exchanging credentials with Volcano auth and
  keeping the tokens in `__Host-` cookies with
  `Path=/; Secure; HttpOnly; SameSite=Strict` and no `Domain`.
- Other frontends count as the same site, and routed responses follow the
  project's CORS settings. Refuse any request whose `Sec-Fetch-Site` is
  neither `same-origin` nor `none` (a page the visitor opened directly), GETs
  included. Older browsers omit the header; then refuse an `Origin` that is
  present and isn't the site's own. Require a CSRF token on every
  state-changing request.
- An HTTP-mode handler reads `event.method`, `event.path`, `event.headers`,
  and `event.body` (base64 when `event.is_base64_encoded` is true). Header
  names arrive in canonical case (`Sec-Fetch-Site`) and every value is an
  array, so look names up case-insensitively and join the values, as the
  documented session example does. Return several cookies through
  `multiValueHeaders`:
  `{ statusCode: 200, multiValueHeaders: { "Set-Cookie": [a, b] }, body }`.
- Manage routes from the manifest, or with
  `volcano cloud frontends routes create web --path /api/session --function session --strip-prefix`.
  Locally (CLI 0.45.0+), use `volcano frontends routes create ...`, or
  declare `function_routes` in the manifest and run `volcano deploy`, which
  deploys the frontend and applies its routes.
- `volcano docs search "function routes"` finds the full session example,
  including sign-in, sign-out, and the CSRF check.

## Handler Templates

Volcano Functions return a standard response shape: handlers return `{ statusCode, body, headers? }` where `body` is a string. Use `JSON.stringify(...)` to encode JSON responses. **Use `statusCode: 200` for all successful responses (not `201`/`202`) — `volcano functions invoke` treats any non-200 status as a failed invocation, so a `201 Created` reads as a failure to the CLI and to callers checking status; put the created resource in the `body` with `200`.**

### Basic handler
```js
// functions/hello.js
exports.handler = async (event) => {
  const name = event.name || 'World';
  return {
    statusCode: 200,
    body: JSON.stringify({ message: `Hello, ${name}!` }),
  };
};
```

### Authenticated handler with Volcano Database
```ts
// functions/get-my-posts.ts
import { VolcanoAuth } from '@volcano.dev/sdk';

function createClient(auth?: { access_token?: string }): VolcanoAuth {
  const volcano = new VolcanoAuth({
    apiUrl: process.env.VOLCANO_API_URL!,
    anonKey: process.env.VOLCANO_ANON_KEY!,
    accessToken: auth?.access_token,
  });
  volcano.database(process.env.VOLCANO_DATABASE!);
  return volcano;
}

export const handler = async (event: { __volcano_auth?: { access_token?: string } }) => {
  const auth = event.__volcano_auth;
  if (!auth) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const volcano = createClient(auth);
  const { data, error } = await volcano
    .from('posts')
    .select('id, title, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
  return { statusCode: 200, body: JSON.stringify({ posts: data ?? [] }) };
};
```

### Server-side mutation
```ts
// functions/publish-post.ts
export const handler = async (event: {
  postId?: string;
  __volcano_auth?: { access_token?: string };
}) => {
  const auth = event.__volcano_auth;
  if (!auth) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (!event.postId) return { statusCode: 400, body: JSON.stringify({ error: 'postId is required' }) };

  const volcano = createClient(auth);
  const { data, error } = await volcano
    .update('posts', { status: 'published' })
    .eq('id', event.postId);

  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, body: JSON.stringify({ post: data?.[0] ?? null }) };
};
```

### Calling external APIs with secrets
```js
// functions/send-slack-notification.js
exports.handler = async (event) => {
  const auth = event.__volcano_auth;
  if (!auth) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { channel, message } = event;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, text: message, username: 'Volcano Bot' }),
  });

  if (!response.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send notification' }) };
  }
  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
```

### Forward a webhook to a durable workflow
A durable workflow waiting with `ctx.waitForMessage` resumes when the webhook
receiver sends it a message (see `volcano-durable`). Make the receiver a
public HTTP-mode function that skips Volcano auth, verify the provider's
signature, and send with the service key from a project variable. Add
`PUBLISHER_WEBHOOK_SECRET`, `VOLCANO_API_URL`, and `VOLCANO_SERVICE_KEY` to
`volcano/volcano.env` and `volcano/cloud.env`, and select them in the
function's entry so a deploy without them fails instead of the receiver
reading `undefined`. `volcano status` prints
the local server's service key. For the cloud, create a narrower one with
`volcano projects keys service create webhooks --permission functions.invoke
--json`. It can still invoke any of the project's functions, private ones
included, and start and message any durable execution, so say that when you
ask the user to confirm creating it:
```yaml
# volcano-config.yaml
version: 1
functions:
  - name: publisher-webhook
    visibility: public
    invocation_mode: http
    http_auth_mode: none
    variable_scope: scoped
    variables: [PUBLISHER_WEBHOOK_SECRET, VOLCANO_API_URL, VOLCANO_SERVICE_KEY]
```
```js
// functions/publisher-webhook.js
const crypto = require('node:crypto');
const { VolcanoAuth } = require('@volcano.dev/sdk');

function header(event, name) {
  const key = Object.keys(event.headers || {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? event.headers[key].join(',') : '';
}

exports.handler = async (event) => {
  const rawBody = Buffer.from(event.body || '', event.is_base64_encoded ? 'base64' : 'utf8');
  const expected = crypto
    .createHmac('sha256', process.env.PUBLISHER_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const supplied = Buffer.from(header(event, 'publisher-signature'));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, Buffer.from(expected))) {
    return { statusCode: 401, body: 'invalid signature' };
  }

  const hook = JSON.parse(rawBody.toString('utf8'));
  // The id the app saved when it started the workflow for this post.
  const executionId = await executionIdForPost(hook.post_id);
  // The callback can beat the app saving the id; a retry delivers it.
  if (!executionId) return { statusCode: 503, body: 'workflow not started' };

  // Server code passes the service key as anonKey; the SDK refuses it only in a browser.
  const volcano = new VolcanoAuth({
    apiUrl: process.env.VOLCANO_API_URL,
    anonKey: process.env.VOLCANO_SERVICE_KEY,
  });
  const sent = await volcano.durable.messages.send(
    { functionName: 'publish-post', executionId },
    'posted',
    { url: hook.url },
    { idempotencyKey: hook.id },
  );
  if (sent.error) {
    // Only an ended execution or data it will never take is final.
    const final = sent.status === 400 || sent.error.code === 'execution_not_running';
    if (!final) return { statusCode: 503, body: sent.error.message };
    console.error('publisher webhook dropped', hook.id, sent.status, sent.error.message);
  }
  return { statusCode: 200, body: '' };
};
```
- The provider's event id as `idempotencyKey` makes its retries harmless.
- Acknowledge and log only what no retry can fix: `409`
  `execution_not_running` (the workflow ended) and a `400` (data over 64 KiB
  or another invalid send). Return `503` for everything else so the provider
  retries: an execution id not saved yet, a network error (`status` is
  `null`), `429`, a `5xx`, a full queue,
  and a `401`, `403`, or `404`, which can each mean the variable holds the
  wrong key (a `404` for a running execution usually means the anon key). The
  provider stops on its own schedule, and a corrected variable lets its next
  retry deliver.
- The service key reaches every execution in the project. Select it only in
  the receiver's `variables`, and give every other function a
  `variable_scope: scoped` list too: a function without one receives every
  project variable, the service key included.

## When to Use Functions
| Use case | Example |
|---|---|
| Third-party APIs with secrets | Stripe, SendGrid, Slack |
| Background / scheduled jobs | Daily aggregations, report generation |
| Admin / privileged operations | Bulk moderation, approvals |
| File processing | Image resize, PDF generation |
| Multi-step orchestration | Stitching several API calls atomically |

If the work is "fetch this user's rows" with RLS, do it client-side; functions add latency and complexity for nothing.

## Error Handling

### Client side
```ts
const { data, error } = await volcano.functions.invoke('process-payment', {
  amount: 1999,
  currency: 'usd',
});

if (error) {
  // Network error or function threw
  showErrorToast('Payment failed. Please try again.');
  return;
}

// Business-logic errors are returned in the body, not as `error`
if (data.error) {
  showErrorToast(data.error);
  return;
}
```

### Function side
```js
exports.handler = async (event) => {
  try {
    const result = await processPayment(event);
    return { statusCode: 200, body: JSON.stringify({ success: true, paymentId: result.id }) };
  } catch (err) {
    console.error('Payment error:', err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: err.message, code: err.code || 'PAYMENT_FAILED' }),
    };
  }
};
```

## Environment Variables
Functions receive **only user-defined project variables**. Volcano does not auto-inject any variables — you must deploy them yourself:
```sh
volcano variables deploy                          # local, from volcano/volcano.env
volcano cloud variables deploy -f volcano/cloud.env   # cloud (requires volcano login + volcano use)
```
This sets project-scoped variables available to all functions at runtime. `volcano/volcano.env` holds the local server's values; keep the cloud project's in `volcano/cloud.env`. `volcano deploy` (or `volcano cloud deploy --env-file volcano/cloud.env`) deploys them before the functions in the same run.

**Canonical names** (the shared client factory expects these):
- `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, `VOLCANO_DATABASE` (defaults to `'app'`).

**Custom secrets** (any name): `STRIPE_SECRET_KEY`, `SENDGRID_API_KEY`, etc.

Never hardcode secrets in code.

## Best Practices
- **Validate input** at the top of the handler; return `400` with a descriptive message.
- **Check `__volcano_auth`** and return `401` early for unauthenticated calls.
- **Keep clients request-scoped** — build the Volcano client inside the handler with the request's auth, not in module globals.
- **Time-box long ops** — handlers have execution limits; abort or stream early.
- **Use `console.log`** for debug output, then fetch it with the CLI — `volcano functions logs <name> --type runtime` (`--type build` for deploy/packaging errors) — before reaching for the Volcano dashboard, which is a secondary view for cloud projects only. `--follow` streams indefinitely like `tail -f`; bound it (e.g. `timeout 15 ... --follow`) rather than running it as a bare synchronous call.

## Verification Checklist
- Secret-bearing logic remains server-side.
- Invocation handles `status` and `error` explicitly.
- User context assumptions are explicit (`event.__volcano_auth`).
- Database work inside functions uses the same Volcano Database query-builder flow as the rest of the app.
- Input is validated; auth check fires before any side effects.

## Optional Fallback References
