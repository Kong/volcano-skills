import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const skill = readFileSync(new URL('../volcano-realtime/SKILL.md', import.meta.url), 'utf8');
const example = skill.match(/## Initial Fetch \+ Subscribe Pattern\n```ts\n([\s\S]*?)\n```/)?.[1];
assert.ok(example, 'initial fetch example exists');

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function harness({ failAt } = {}) {
  const state = {
    rows: [], queries: [], publications: [], errors: [], timers: new Map(),
    intervals: new Map(), listeners: new Map(), handlers: new Map(),
    disconnects: 0, unsubscribes: 0, nextTimer: 1,
  };
  let client;
  const window = {
    setTimeout(callback, delay) {
      assert.equal(delay, 250);
      const id = state.nextTimer++;
      state.timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { state.timers.delete(id); },
    setInterval(callback, delay) {
      assert.equal(delay, 30_000);
      const id = state.nextTimer++;
      state.intervals.set(id, callback);
      return id;
    },
    clearInterval(id) { state.intervals.delete(id); },
    addEventListener(event, callback) { state.listeners.set(event, callback); },
    removeEventListener(event, callback) {
      if (state.listeners.get(event) === callback) state.listeners.delete(event);
    },
  };
  class VolcanoRealtime {
    constructor() { client = this; }
    async connect() {
      if (failAt === 'connect') throw new Error('connect failed');
    }
    channel() {
      return {
        onPostgresChanges(type, schema, table, callback) {
          assert.equal(schema, 'public');
          assert.equal(table, 'posts');
          state.handlers.set(type, callback);
        },
        async subscribe() {
          if (failAt === 'subscribe') throw new Error('subscribe failed');
        },
        unsubscribe() { state.unsubscribes += 1; },
      };
    }
    onConnect(callback) {
      this.reconnect = callback;
      return () => { this.reconnect = undefined; };
    }
    disconnect() { state.disconnects += 1; }
  }
  const volcano = {
    accessToken: 'test-token',
    database(name) { assert.equal(name, 'app'); },
    from(table) {
      assert.equal(table, 'posts');
      return {
        select(columns) {
          assert.equal(columns, '*');
          return {
            order(field, options) {
              assert.equal(field, 'created_at');
              assert.deepEqual({ ...options }, { ascending: false });
              return {
                limit(count) {
                  assert.equal(count, 50);
                  return new Promise((resolve) => state.queries.push({ resolve }));
                },
              };
            },
          };
        },
      };
    },
  };
  const context = {
    volcano, VolcanoRealtime, window, apiUrl: 'test-url', anonKey: 'test-key',
    setPosts(value) {
      assert.ok(Array.isArray(value), 'only snapshots may publish');
      state.publications.push(value);
    },
    showConnectionError(message) { state.errors.push(message); },
  };
  vm.runInNewContext(`${example}\nglobalThis.stop = stopPostsSubscription;`, context);
  const nextQuery = async () => {
    const query = state.queries.shift();
    assert.ok(query, 'query was scheduled');
    query.resolve(failAt === 'snapshot'
      ? { error: new Error('snapshot failed') }
      : { data: [...state.rows].sort((a, b) => b.created_at - a.created_at).slice(0, 50), error: null });
    await flush();
  };
  const fireTimer = async () => {
    const [id, callback] = state.timers.entries().next().value ?? [];
    assert.ok(callback, 'reconciliation timer exists');
    state.timers.delete(id);
    callback();
    await flush();
  };
  return { state, client: () => client, stop: context.stop, flush, nextQuery, fireTimer,
    emit(type, record) { state.handlers.get(type)({ record }); } };
}

{
  const h = harness();
  h.state.rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, created_at: 100 - i }));
  await h.flush();
  for (let i = 0; i < 5; i += 1) {
    for (let event = 0; event < 20; event += 1) h.emit('UPDATE', { id: 999, created_at: 0 });
    assert.equal(h.state.timers.size, 0, 'events during query wait for completion');
    await h.nextQuery();
    assert.equal(h.state.publications.length, i + 1, 'each snapshot publishes despite sustained events');
    assert.equal(h.state.publications.at(-1).length, 50);
    assert.deepEqual(h.state.publications.at(-1).map((row) => row.id), h.state.rows.map((row) => row.id));
    assert.equal(h.state.queries.length, 0, 'no immediate query loop');
    assert.equal(h.state.timers.size, 1, 'one delayed query for buffered events');
    await h.fireTimer();
    assert.equal(h.state.queries.length, 1, 'one query after the delay');
  }
  h.emit('UPDATE', { id: 999, created_at: 0 });
  await h.nextQuery();
  assert.equal(h.state.publications.at(-1).length, 50, 'out-of-window event does not grow the view');
  h.state.rows.push({ id: 1000, created_at: 200 });
  for (let event = 0; event < 20; event += 1) h.emit('INSERT', { id: 1000, created_at: 200 });
  assert.equal(h.state.timers.size, 1, 'idle events share one timer');
  assert.equal(h.state.publications.at(-1).length, 50, 'events never directly mutate the view');
  await h.fireTimer();
  await h.nextQuery();
  assert.equal(h.state.publications.at(-1).length, 50);
  assert.equal(h.state.publications.at(-1)[0].id, 1000, 'newest insert sorts first');
  assert.equal(h.state.publications.at(-1).some((row) => row.id === 50), false, 'oldest row falls outside cap');
  h.state.rows = h.state.rows.filter((row) => row.id !== 1000);
  h.state.intervals.values().next().value();
  await h.flush();
  await h.nextQuery();
  assert.equal(h.state.publications.at(-1).some((row) => row.id === 1000), false, 'periodic refresh removes external deletes');
  assert.equal(h.state.publications.at(-1).length, 50);
  h.stop();
  assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.intervals.size, 0);
  assert.equal(h.state.listeners.size, 0);
  assert.equal(h.client().reconnect, undefined);
}

{
  const h = harness();
  await h.flush();
  await h.nextQuery();
  h.state.listeners.get('focus')();
  await h.flush();
  h.emit('INSERT', { id: 42, created_at: 42 });
  h.stop();
  const count = h.state.publications.length;
  await h.nextQuery();
  assert.equal(h.state.publications.length, count, 'late query cannot publish after stop');
  assert.equal(h.state.timers.size, 0, 'late query cannot schedule another query');
  h.emit('UPDATE', { id: 43, created_at: 43 });
  assert.equal(h.state.timers.size, 0, 'late events cannot schedule work');
}

for (const failAt of ['connect', 'subscribe', 'snapshot']) {
  const h = harness({ failAt });
  await h.flush();
  if (failAt === 'snapshot') await h.nextQuery();
  assert.deepEqual(h.state.errors, [`${failAt} failed`]);
  assert.ok(h.state.disconnects > 0, `${failAt} failure disconnects`);
  assert.equal(h.state.unsubscribes, failAt === 'connect' ? 0 : 1);
  assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.intervals.size, 0);
  assert.equal(h.state.listeners.size, 0);
  assert.equal(h.client().reconnect, undefined);
}

console.log('realtime example: OK (bounded publication, ordered cap, delete, stop, setup failures)');
