---
name: volcano-realtime
description: Use for realtime or live updates in Volcano apps, including collaborative boards, chat, presence and online users, live polls and results, leaderboards, Postgres changes, broadcast, WebSockets, and connection lifecycle.
---
# Volcano Realtime Skill

## Role
Implement live updates with deterministic realtime lifecycle handling. This skill is self-contained: connection lifecycle, all three channel types (postgres / broadcast / presence), token refresh, and cleanup are embedded.

## Workflow
1. Enable realtime for the project — `realtime: { enabled: true }` in `volcano-config.yaml`, then `config deploy` (off by default; see "Enable realtime").
2. Initialize `VolcanoRealtime` with `apiUrl`, `anonKey`, and `accessToken` (or `getToken`).
3. `connect()`, then create channels with the right `type`.
4. Register handlers BEFORE calling `subscribe()`.
5. Always pair `subscribe()` with `unsubscribe()` on teardown; pair `connect()` with `disconnect()`.
6. Subscriptions respect RLS — channel scope is minimal (specific table/event).

## Dependencies
- `centrifuge` is required.
- `ws` only for Node.js server-side realtime usage. The SDK uses the browser's native `WebSocket` automatically and `ws` automatically in Node.js — provide a custom implementation only for advanced cases (see "Custom WebSocket Implementation" below).

## Enable realtime (required)
Realtime is **disabled by default for every project — local and cloud alike**
(`enabled: false`). Until you enable it, every connection is rejected with
`realtime disabled for project`. Declare it in `volcano-config.yaml` and deploy:
```yaml
realtime:
  enabled: true                     # required — off by default
  # broadcast_enabled: true         # optional, default true
  # presence_enabled: true          # optional, default true
  # postgres_changes_enabled: true  # optional, default true
```
Apply with `volcano config deploy` (local) / `volcano cloud config deploy`
(cloud). This is the **only** realtime setup that isn't app code — the same
config governs both environments, so a realtime app verified locally deploys to
the cloud unchanged. Everything else (`apiUrl`/`anonKey`/`accessToken`, channels,
handlers) is identical across environments. In local mode, `apiUrl` is
`http://localhost:8000` with the local anon key from `volcano status`, and you
can sign in as the shipped default user (`clearwater@volcano.dev`) to get an
`accessToken` without building a signup flow first.

## Initialization
```ts
import { VolcanoRealtime } from '@volcano.dev/sdk/realtime';

const realtime = new VolcanoRealtime({
  apiUrl: 'https://api.yourproject.volcano.dev',
  anonKey: 'your-anon-key',
  accessToken: volcano.accessToken, // JWT from auth session
});

await realtime.connect();
```

## Browser Origins and CORS

Browser WebSocket connections include an `Origin` header. When CORS is enabled for your project, that origin must be listed in the project's auth CORS allowed origins or the WebSocket upgrade is rejected **before** authentication completes — connect fails silently from the client's point of view.

For local development, add your app origin (e.g. `http://localhost:3000`) to the project's auth CORS allowed origins in the Volcano dashboard.

Server-side Node.js connections usually do not send an `Origin` header and are not blocked by browser CORS checks.

**Symptoms of a CORS misconfiguration:**
- `realtime.connect()` resolves but `onConnect` never fires.
- `onError` fires with an opaque WebSocket error (no message).
- Browser DevTools shows the WebSocket request with status `Failed` or `(blocked)`.
- Same setup works on production but not on localhost (or vice versa).

**Fix:** add the origin to the project's auth CORS allowed origins, then reconnect.

## Custom WebSocket Implementation

Most applications do not need this. The SDK uses the browser's native `WebSocket` in browsers and `ws` in Node.js. For Node.js tests or advanced server-side clients that need to inject custom headers (e.g., a fixed `Origin` header to satisfy CORS in a non-browser context), pass a `webSocket` constructor:

```js
import WebSocket from 'ws';

class OriginWebSocket extends WebSocket {
  constructor(address, protocols, options = {}) {
    super(address, protocols, {
      ...options,
      headers: {
        ...options.headers,
        Origin: 'https://app.example.com',
      },
    });
  }
}

const realtime = new VolcanoRealtime({
  apiUrl: 'https://api.yourproject.volcano.dev',
  anonKey: 'your-anon-key',
  accessToken: volcano.accessToken,
  webSocket: OriginWebSocket,
});
```

The `webSocket` config takes any `WebSocket`-compatible constructor — useful for tests that mock the transport, or for environments that need TLS client certs / proxy support beyond what `ws` exposes by default.

## Connection Events
```ts
realtime.onConnect((ctx) => {
  // ctx.client, ctx.latency
});
realtime.onDisconnect((ctx) => {
  // ctx.reason, ctx.reconnect (auto-reconnect with exponential backoff)
});
realtime.onError((ctx) => {
  // ctx.message
});
```

## Postgres Changes — live DB events

### Setup
```ts
const channel = realtime.channel('public:posts', {
  type: 'postgres',
  databaseName: 'app',
});
```

The channel name is `schema:table`, and it must match each `onPostgresChanges` handler. `databaseName` selects the project database. The SDK includes it in the wire channel and subscription data.

### Listen for ALL events on a table
```ts
channel.onPostgresChanges('*', 'public', 'posts', (change) => {
  // change.type: 'INSERT' | 'UPDATE' | 'DELETE'
  // change.table, change.schema, change.timestamp
  // INSERT/UPDATE: change.record when auto-fetch succeeds
  // DELETE: available to service-key subscriptions only
});
await channel.subscribe();
```

### Filter by event type
```ts
channel.onPostgresChanges('INSERT', 'public', 'posts', (c) => {
  if (c.record) addPost(c.record);
  else void reconcilePosts(); // authoritative fallback for a lightweight event
});
channel.onPostgresChanges('UPDATE', 'public', 'posts', (c) => {
  if (c.record) updatePost(c.record);
  else void reconcilePosts();
});
// DELETE handlers receive events only on service-key subscriptions.
channel.onPostgresChanges('DELETE', 'public', 'posts', (c) => removePost(c.old_record?.id ?? c.id));
```

`record` is optional. Standalone clients and failed auto-fetches deliver a
lightweight event with `id` instead, so reconcile or fetch that row rather than
dereferencing `record` unconditionally.

### Subscribe to multiple tables
Use one channel for each table:

```ts
const posts = realtime.channel('public:posts', { type: 'postgres', databaseName: 'app' });
const comments = realtime.channel('public:comments', { type: 'postgres', databaseName: 'app' });

posts.onPostgresChanges('*', 'public', 'posts', handlePostChange);
comments.onPostgresChanges('*', 'public', 'comments', handleCommentChange);
await Promise.all([posts.subscribe(), comments.subscribe()]);
```

### RLS interaction
Each user receives only events for rows their RLS policy allows them to select. Authenticated user subscriptions do not receive DELETE events because the deleted row is unavailable for the RLS check. Service-key subscriptions bypass RLS and can receive DELETE events.

## Broadcast — ephemeral pub/sub
Messages aren't persisted; only currently subscribed clients receive them.

### Setup
```ts
const channel = realtime.channel('notifications', { type: 'broadcast' });
```

### Send and receive
```ts
channel.on('notification', (data) => {
  showNotification(data.title, data.message);
});
channel.on('*', (data, ctx) => {
  // catch-all listener
});
await channel.subscribe();

await channel.send({
  type: 'notification',
  title: 'New Feature!',
  message: 'Check out our latest update',
});
```

### Use cases
- Typing indicators
- Cursor positions in collaborative editors
- System-wide notifications
- Game-state synchronization

### Typing indicator pattern
```ts
const channel = realtime.channel('chat-room-123', { type: 'broadcast' });

channel.on('typing', (data) => {
  if (data.user_id !== currentUser.id) showTyping(data.user_id);
});
channel.on('stopped_typing', (data) => hideTyping(data.user_id));
await channel.subscribe();

let typingTimer: any;
function onInput() {
  channel.send({ type: 'typing', user_id: currentUser.id });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    channel.send({ type: 'stopped_typing', user_id: currentUser.id });
  }, 2000);
}
```

## Presence — who's online and their state

### Setup
```ts
const channel = realtime.channel('lobby', { type: 'presence' });
```

### Track and listen
```ts
await channel.subscribe();

await channel.track({
  user_id: currentUser.id,
  username: currentUser.name,
  status: 'online',
  avatar: currentUser.avatar_url,
});

channel.onPresenceSync((state) => {
  // state: { [clientId]: userData }
  const onlineUsers = Object.entries(state).map(([clientId, data]) => ({ clientId, ...data }));
  updateOnlineUsersList(onlineUsers);
});
```

### Read state at any time
```ts
const state = channel.getPresenceState();
for (const [clientId, userData] of Object.entries(state)) {
  // ...
}
```

### Update state
```ts
await channel.track({
  user_id: currentUser.id,
  username: currentUser.name,
  status: 'away',
  last_seen: new Date().toISOString(),
});
```

## Channel Management
```ts
channel.unsubscribe();
realtime.removeChannel('my-channel', 'postgres');
realtime.removeAllChannels();
realtime.isConnected(); // boolean
realtime.disconnect();
```

## Dynamic Token Refresh — `accessToken` vs `getToken`

Use **`accessToken`** for short-lived UI sessions where the page lifecycle is bounded by JWT expiry (~1 hour). Use **`getToken`** for long-lived clients — background tabs, desktop/native apps, edge workers, server-side polling — so the realtime client refreshes the JWT seamlessly without dropping the connection.
```ts
const realtime = new VolcanoRealtime({
  apiUrl: 'https://api.example.com',
  anonKey: 'anon-key',
  getToken: async () => {
    const { session } = await volcano.auth.refreshSession();
    return session.access_token;
  },
});
```

## Auto-Fetch Integration with VolcanoAuth
```ts
const volcano = new VolcanoAuth({ ... });
volcano.database('your_database_name');

const realtime = new VolcanoRealtime({
  apiUrl: 'https://api.example.com',
  anonKey: 'anon-key',
  accessToken: volcano.accessToken,
  volcanoClient: volcano,         // enables auto-fetch lightweight mode
  databaseName: 'your_database_name', // optional if database(...) was called
});
```

## TypeScript
```ts
import {
  VolcanoRealtime,
  RealtimeChannel,
  PostgresChange,
  PresenceState,
  ConnectContext,
  DisconnectContext,
  ErrorContext,
} from '@volcano.dev/sdk/realtime';
```

## Initial Fetch + Subscribe Pattern
```ts
const databaseName = 'app';
volcano.database(databaseName);

const realtime = new VolcanoRealtime({
  apiUrl,
  anonKey,
  accessToken: volcano.accessToken,
  volcanoClient: volcano,
  databaseName,
});
await realtime.connect();

const channel = realtime.channel('public:posts', {
  type: 'postgres',
  databaseName,
});

let subscribed = false;
let reconciling = false;
let reconcileAgain = false;

function upsertPost(posts, record) {
  const index = posts.findIndex((post) => post.id === record.id);
  if (index === -1) return [record, ...posts];
  const next = [...posts];
  next[index] = record;
  return next;
}

async function reconcilePosts() {
  if (reconciling) {
    reconcileAgain = true;
    return;
  }

  reconciling = true;
  try {
    do {
      reconcileAgain = false;

      const { data, error } = await volcano
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      if (!reconcileAgain) setPosts(data ?? []);
    } while (reconcileAgain);
  } finally {
    reconciling = false;
  }
}

function handlePostChange(change) {
  if (reconciling) {
    // Any event during the query needs a confirming snapshot; its row may be deleted.
    reconcileAgain = true;
  } else if (change.record) {
    setPosts((current) => upsertPost(current, change.record));
  } else {
    void reconcilePosts().catch((error) => showConnectionError(error.message));
  }
}

// Register handlers and reach subscription acceptance before taking the snapshot.
channel.onPostgresChanges('INSERT', 'public', 'posts', handlePostChange);
channel.onPostgresChanges('UPDATE', 'public', 'posts', handlePostChange);

const stopReconnectHandler = realtime.onConnect(() => {
  if (!subscribed) return; // Ignore the initial connection; bootstrap below owns it.
  void channel
    .subscribe()
    .then(() => reconcilePosts())
    .catch((error) => showConnectionError(error.message));
});

await channel.subscribe();
subscribed = true;
await reconcilePosts();

// End users receive no DELETE event; refresh focused views periodically too.
const reconcileOnFocus = () => {
  void reconcilePosts().catch((error) => showConnectionError(error.message));
};
window.addEventListener('focus', reconcileOnFocus);
const postsRefreshInterval = window.setInterval(reconcileOnFocus, 30_000);

function stopPostsSubscription() {
  window.removeEventListener('focus', reconcileOnFocus);
  window.clearInterval(postsRefreshInterval);
  stopReconnectHandler();
  channel.unsubscribe();
  realtime.disconnect();
}
```

Subscribing first closes the snapshot-to-subscription gap. Any INSERT or UPDATE
arriving during the query triggers a confirming authoritative snapshot, even if
it includes `record`; that row may already have been deleted. Reconcile after
reconnect, after relevant mutations, immediately on focus, and every 30 seconds
while the view is active. End-user subscriptions do not receive `DELETE` events;
use a server-side service-key subscription when a `DELETE` callback is required.

## React Cleanup Pattern
```tsx
useEffect(() => {
  let disposed = false;
  const realtime = new VolcanoRealtime({ /* ... */ });
  const channel = realtime.channel('public:posts', {
    type: 'postgres',
    databaseName: 'app',
  });
  channel.onPostgresChanges('*', 'public', 'posts', handleChange);

  void (async () => {
    try {
      await realtime.connect();
      if (disposed) {
        realtime.disconnect();
        return;
      }
      await channel.subscribe();
    } catch (error) {
      if (!disposed) showConnectionError(error.message);
    }
  })();

  return () => {
    disposed = true;
    channel.unsubscribe();
    realtime.disconnect();
  };
}, []);
```

## Best Practices
- **Throttle presence updates** (e.g., 1 Hz) to avoid flooding the channel.
- **Reconcile after subscription acceptance and reconnect** — repeat the authoritative snapshot when INSERT or UPDATE arrives during the query.
- **Reconcile external deletes** — end users receive no DELETE event, so refresh long-lived views on focus and a bounded periodic interval.
- **Scope channels** to specific tables/events; broad subscriptions hurt RLS clarity and bandwidth.
- **Use one database selector** — select the same `databaseName` on the query client and realtime client/channel.
- **Handle lightweight changes** — `record` is optional; use `id` to fetch or reconcile when it is absent.
- **Use `getToken`** for long-lived sessions instead of a static `accessToken`.

## Error Handling
```ts
realtime.onError((ctx) => {
  showConnectionError(ctx.message);
});

try {
  await channel.subscribe();
} catch (error) {
  console.error('Subscription failed:', error.message);
}
```

**Connection rejected (connect times out or never accepts):**
- `realtime disabled for project` — realtime is off for this project; add
  `realtime: { enabled: true }` to `volcano-config.yaml` and `config deploy`
  (see "Enable realtime"). Off by default in local **and** cloud.
- `invalid apikey` / `anon key not found` — wrong `anonKey` for the target
  project (or the wrong `apiUrl`).
- Missing/invalid token — realtime requires an authenticated session; pass a
  real `accessToken` (`signIn` first). There is no anonymous/token-less
  realtime connection, in local or cloud.

## Verification Checklist
- Realtime is enabled for the project (`realtime: { enabled: true }` in `volcano-config.yaml`, `config deploy`d) — off by default.
- `connect()` is paired with `disconnect()`; `subscribe()` is paired with `unsubscribe()`.
- `connect()` is awaited before `subscribe()`; asynchronous setup cannot outlive component teardown.
- Handlers are registered before `subscribe()`.
- Query and realtime clients use the same database selector.
- Postgres handlers treat `record` as optional and reconcile lightweight events.
- Initial snapshots happen after subscription acceptance and merge events received during the query; reconnects and external deletes have reconciliation triggers.
- Realtime behavior matches RLS expectations (per-user delivery).
- Presence updates are throttled when bound to high-frequency events.
- Dependencies: `centrifuge` is present; `ws` only when Node-side realtime is used.

## Optional Fallback Reference
