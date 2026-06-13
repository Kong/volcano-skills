---
name: volcano-functions
description: Detailed guidance for server-side function invocation and orchestration with Volcano
---
# Volcano Functions Skill

## Role
Use Volcano Functions for privileged, secret-bearing, or orchestration-heavy backend logic. This skill is self-contained: invocation, response shape, handler templates, env, and error handling are embedded.

## Workflow
1. Confirm the operation belongs in Functions (privileged/secrets/heavy orchestration). If it's a plain RLS-protected query, do it client-side via Volcano Database instead.
2. Implement invocation with explicit success and failure handling.
3. Enforce user-context assumptions where authorization matters.
4. Route persistent data access through the Volcano Database query-builder pattern.
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

## Handler Templates

Volcano Functions return a standard response shape: handlers return `{ statusCode, body, headers? }` where `body` is a string. Use `JSON.stringify(...)` to encode JSON responses.

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
  volcano.database(process.env.VOLCANO_DB_NAME!);
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
    .eq('id', event.postId)
    .select();

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
Set in the Volcano dashboard. Always available inside the handler:
- Volcano: `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, `VOLCANO_DB_NAME`.
- Custom (any name): `STRIPE_SECRET_KEY`, `SENDGRID_API_KEY`, etc.

Never hardcode secrets in code.

## Best Practices
- **Validate input** at the top of the handler; return `400` with a descriptive message.
- **Check `__volcano_auth`** and return `401` early for unauthenticated calls.
- **Keep clients request-scoped** — build the Volcano client inside the handler with the request's auth, not in module globals.
- **Time-box long ops** — handlers have execution limits; abort or stream early.
- **Use `console.log`** for debug output; logs surface in the Volcano dashboard.

## Verification Checklist
- Secret-bearing logic remains server-side.
- Invocation handles `status` and `error` explicitly.
- User context assumptions are explicit (`event.__volcano_auth`).
- Database work inside functions uses the same Volcano Database query-builder flow as the rest of the app.
- Input is validated; auth check fires before any side effects.

## Optional Fallback References
