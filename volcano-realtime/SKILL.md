---
name: volcano-realtime
description: Detailed guidance for live subscriptions, broadcast, and presence with Volcano Realtime
---
# Volcano Realtime Skill

## Role
Implement live updates with deterministic realtime lifecycle handling. This skill is self-contained: connection lifecycle, all three channel types (postgres / broadcast / presence), token refresh, and cleanup are embedded.

## Workflow
1. Initialize `VolcanoRealtime` with `apiUrl`, `anonKey`, and `accessToken` (or `getToken`).
2. `connect()`, then create channels with the right `type`.
3. Register handlers BEFORE calling `subscribe()`.
4. Always pair `subscribe()` with `unsubscribe()` on teardown; pair `connect()` with `disconnect()`.
5. Subscriptions respect RLS — channel scope is minimal (specific table/event).

## Dependencies
- `centrifuge` is required.
- `ws` only for Node.js server-side realtime usage. The SDK uses the browser's native `WebSocket` automatically and `ws` automatically in Node.js — provide a custom implementation only for advanced cases (see "Custom WebSocket Implementation" below).

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
const channel = realtime.channel('my-changes', { type: 'postgres' });
```

The signature is `channel.onPostgresChanges(eventType, schema, table, callback)`. The `schema` argument is the **Postgres schema name** — typically `'public'` for application tables.

### Listen for ALL events on a table
```ts
channel.onPostgresChanges('*', 'public', 'posts', (change) => {
  // change.type: 'INSERT' | 'UPDATE' | 'DELETE'
  // change.table, change.schema, change.timestamp
  // INSERT: change.record
  // UPDATE: change.record, change.old_record, change.columns
  // DELETE: change.old_record
});
await channel.subscribe();
```

### Filter by event type
```ts
channel.onPostgresChanges('INSERT', 'public', 'messages', (c) => addMessage(c.record));
channel.onPostgresChanges('UPDATE', 'public', 'posts', (c) => updatePost(c.record));
channel.onPostgresChanges('DELETE', 'public', 'posts', (c) => removePost(c.old_record.id));
```

### Multiple tables on one channel
```ts
const channel = realtime.channel('app-changes', { type: 'postgres' });
channel.onPostgresChanges('*', 'public', 'posts', handlePostChange);
channel.onPostgresChanges('*', 'public', 'comments', handleCommentChange);
channel.onPostgresChanges('*', 'public', 'reactions', handleReactionChange);
await channel.subscribe();
```

### RLS interaction
Each user only receives events for rows their RLS policy allows them to see. Same channel, different deliveries per user.

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
// Load initial data
const { data: posts } = await volcano
  .from('posts')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(50);
setPosts(posts ?? []);

// Subscribe for updates
channel.onPostgresChanges('INSERT', 'public', 'posts', (c) => {
  setPosts((cur) => [c.record, ...cur]);
});
channel.onPostgresChanges('UPDATE', 'public', 'posts', (c) => {
  setPosts((cur) => cur.map((p) => (p.id === c.record.id ? c.record : p)));
});
channel.onPostgresChanges('DELETE', 'public', 'posts', (c) => {
  setPosts((cur) => cur.filter((p) => p.id !== c.old_record.id));
});
await channel.subscribe();
```

## React Cleanup Pattern
```tsx
useEffect(() => {
  const realtime = new VolcanoRealtime({ /* ... */ });
  realtime.connect();
  const channel = realtime.channel('updates', { type: 'postgres' });
  channel.onPostgresChanges('*', 'public', 'posts', handleChange);
  channel.subscribe();

  return () => {
    channel.unsubscribe();
    realtime.disconnect();
  };
}, []);
```

## Best Practices
- **Throttle presence updates** (e.g., 1 Hz) to avoid flooding the channel.
- **Refresh data on reconnect** — call your initial-fetch routine inside `onConnect` so missed events are reconciled.
- **Scope channels** to specific tables/events; broad subscriptions hurt RLS clarity and bandwidth.
- **Combine initial fetch with subscriptions** — the user sees current state immediately and live updates apply on top.
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

## Verification Checklist
- `connect()` is paired with `disconnect()`; `subscribe()` is paired with `unsubscribe()`.
- Handlers are registered before `subscribe()`.
- Realtime behavior matches RLS expectations (per-user delivery).
- Presence updates are throttled when bound to high-frequency events.
- Dependencies: `centrifuge` is present; `ws` only when Node-side realtime is used.

## Optional Fallback Reference
- `http://localhost:9000/docs/sdk/realtime.md`
