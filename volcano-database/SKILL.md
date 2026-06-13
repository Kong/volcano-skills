---
name: volcano-database
description: Detailed guidance for browser and function data access with the Volcano query builder
---
# Volcano Database Skill

## Role
Implement Volcano query-builder access with RLS-first authorization. All persistent data storage MUST use Volcano Databases. This skill is self-contained: the operators, mutation patterns, RLS examples, and error semantics are embedded below.

## Workflow
1. Initialize the client and call `volcano.database(databaseName)` BEFORE any query.
2. Use explicit column lists; avoid `select('*')` unless intentional.
3. Apply deterministic ordering and pagination for list views.
4. Handle mutation errors at every call site; refresh state after writes.

## Setup

### Browser / Client
```ts
import { VolcanoAuth } from '@volcano.dev/sdk';

const volcano = new VolcanoAuth({
  apiUrl: process.env.NEXT_PUBLIC_VOLCANO_API_URL!,
  anonKey: process.env.NEXT_PUBLIC_VOLCANO_ANON_KEY!,
});
volcano.database(process.env.NEXT_PUBLIC_VOLCANO_DATABASE_NAME!);
```

### Function / Server-Side
```ts
function createClient(auth?: { access_token?: string }): VolcanoAuth {
  const volcano = new VolcanoAuth({
    apiUrl: process.env.VOLCANO_API_URL!,
    anonKey: process.env.VOLCANO_ANON_KEY!,
    accessToken: auth?.access_token,
  });
  volcano.database(process.env.VOLCANO_DB_NAME!);
  return volcano;
}
```
Use the same request-scoped client pattern inside Functions handlers when server-side persistence is required.

## SELECT

### Basic
```ts
const { data, error, count } = await volcano.from('posts').select('*');
```

### Specific columns (preferred)
```ts
const { data } = await volcano.from('posts').select('id, title, created_at');
```

### Filter operators
```ts
volcano.from('t').select('*').eq('col', value);     // =
volcano.from('t').select('*').neq('col', value);    // !=
volcano.from('t').select('*').gt('col', n);         // >
volcano.from('t').select('*').gte('col', n);        // >=
volcano.from('t').select('*').lt('col', n);         // <
volcano.from('t').select('*').lte('col', n);        // <=
volcano.from('t').select('*').like('col', 'A%');    // case-sensitive
volcano.from('t').select('*').ilike('col', '%a%');  // case-insensitive
volcano.from('t').select('*').is('col', null);      // NULL check
volcano.from('t').select('*').in('col', [a, b, c]); // IN (...)
```
Pattern syntax: `%` matches any sequence, `_` matches any single character.

### Combine filters (AND)
```ts
const { data } = await volcano
  .from('products')
  .select('id, name, price')
  .eq('category', 'electronics')
  .gte('price', 100)
  .lte('price', 500)
  .eq('in_stock', true);
```

### Ordering
```ts
.order('created_at', { ascending: false })
.order('category', { ascending: true })
.order('created_at', { ascending: false }); // chain for multi-column
```

### Pagination
```ts
const pageSize = 10, page = 3;
const { data, count } = await volcano
  .from('posts')
  .select('id, title')
  .order('created_at', { ascending: false })
  .limit(pageSize)
  .offset((page - 1) * pageSize);
```

### Realistic example
```ts
async function getPublishedPosts(category: string, page = 1) {
  const pageSize = 20;
  const { data, error, count } = await volcano
    .from('posts')
    .select('id, title, excerpt, author_name, created_at')
    .eq('status', 'published')
    .eq('category', category)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  if (error) throw new Error(`Failed to fetch posts: ${error.message}`);
  return { posts: data, totalPages: Math.ceil((count ?? 0) / pageSize), currentPage: page };
}
```

## INSERT
```ts
const { data, error } = await volcano.insert('posts', {
  title: 'My New Post',
  content: 'This is the content.',
  status: 'draft',
});
// data is an array; data[0] is the inserted row including any defaults.
```
If the table has a `user_id` column with default `uid()`, the authenticated user's id is automatically associated.

## UPDATE
```ts
const { data, error } = await volcano
  .update('posts', {
    title: 'Updated Title',
    status: 'published',
    updated_at: new Date().toISOString(),
  })
  .eq('id', postId);
// data[0] is the updated row. Filter is REQUIRED.
```

Bulk update (multiple matching rows):
```ts
await volcano
  .update('posts', { status: 'archived' })
  .lt('created_at', oneYearAgo)
  .eq('status', 'published');
```

## DELETE
```ts
const { data, error } = await volcano.delete('posts').eq('id', postId);
```

### Soft-delete pattern
```ts
// Mark deleted
await volcano.update('posts', { deleted_at: new Date().toISOString() }).eq('id', postId);
// Filter from queries
await volcano.from('posts').select('*').is('deleted_at', null);
```

## Modifiers

### `.single()`
Return a single row (not an array). Errors if zero or more-than-one row matches.
```ts
// After a unique-filter select
const { data: post, error } = await volcano
  .from('posts')
  .select('*')
  .eq('id', postId)
  .single();
// data is the row, not data[0]

// After insert: get the inserted row directly
const { data: task, error } = await volcano
  .insert('tasks', { title, user_id })
  .select()
  .single();
```

## Limitations
The query builder does NOT currently expose:
- **Joins / nested embedded selects** (e.g., `select('*, comments(*)')`).
- **Upserts** (insert-on-conflict-update).
- **Multi-statement transactions.**

When the work genuinely requires one of these, route it through a Volcano Function and use raw SQL via the request-scoped Volcano client. Consult the fallback reference if the SDK has gained these capabilities since this skill was last updated.

## Row-Level Security (RLS)

### How it works
1. Sign-in produces an access token containing the user's id.
2. Every database call includes that token.
3. Volcano sets the user context in the DB session.
4. RLS policies use `uid()` to reference the current user.

### Example policies
```sql
-- Users can only read their own posts
CREATE POLICY "Users can read own posts"
ON posts FOR SELECT
USING (user_id = uid());

-- Users can only update their own posts
CREATE POLICY "Users can update own posts"
ON posts FOR UPDATE
USING (user_id = uid());

-- Users can only insert posts owned by themselves
CREATE POLICY "Users can insert own posts"
ON posts FOR INSERT
WITH CHECK (user_id = uid());

-- Public-read pattern
CREATE POLICY "Published posts are public"
ON posts FOR SELECT
USING (status = 'published');
```

The same client query returns different rows depending on the signed-in user. Do NOT emulate authorization in client code; rely on RLS.

## TypeScript
```ts
interface Post {
  id: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  created_at: string;
}
const { data } = await volcano.from<Post>('posts').select('*').eq('status', 'published');
// data: Post[] | null
```

## Error Handling
All operations return `{ data, error }`. Common messages:
- `column does not exist` — invalid column name (developer error).
- `permission denied` — RLS policy blocked the operation.
- `No active session` — user not authenticated.
- `Database name not set` — forgot `volcano.database(...)`.
- `violates unique constraint` — duplicate value on insert.
- `violates foreign key` — bad reference.
- `violates check constraint` — invalid input.

## Functions Integration
When persistence belongs in a function, keep the same client pattern inside the handler:
```ts
// Client side
const { data, error } = await volcano.functions.invoke('get-dashboard-stats', { timeframe: 'last-30-days' });

// Function side: same query-builder flow with a request-scoped client
export const handler = async (event: { __volcano_auth?: { access_token?: string } }) => {
  const auth = event.__volcano_auth;
  if (!auth) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  const volcano = createClient(auth);
  const { data, error } = await volcano.from('posts').select('id, title, created_at').order('created_at', { ascending: false });
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, body: JSON.stringify({ posts: data ?? [] }) };
};
```

## Best Practices
- Always set the database name once after init.
- Sign in (or accept anonymous) before queries that depend on RLS-bound rows.
- Select only the columns you need.
- Paginate large lists (`.limit(50)` is a sensible default).
- Filter server-side; never fetch everything then filter in JS.
- Return the `error` object from server handlers as `{ statusCode, body: JSON.stringify({ error: error.message }) }`.

## Verification Checklist
- `volcano.database(name)` is called before any query.
- Filter, order, and pagination intent matches the request.
- RLS policies are assumed to exist; no client-side pseudo-authorization.
- Mutations have explicit error handling at the call site.
- Functions doing persistence use a request-scoped client built from `event.__volcano_auth`.

## Optional Fallback Reference
- `http://localhost:9000/docs/sdk/database.md`
