import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const skill = readFileSync(new URL('../volcano-realtime/SKILL.md', import.meta.url), 'utf8');
const example = skill.match(/## Initial Fetch \+ Subscribe Pattern\n```ts\n([\s\S]*?)\n```/)?.[1];
assert.ok(example, 'initial fetch example exists');
const reactExample = skill.match(/## React Cleanup Pattern\n```tsx\n([\s\S]*?)\n```/)?.[1];
assert.ok(reactExample, 'React cleanup example exists');
const multipleTablesExample = skill.match(/### Subscribe to multiple tables[\s\S]*?```ts\n([\s\S]*?)\n```/)?.[1];
assert.ok(multipleTablesExample, 'multiple tables example exists');

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function harness({ failAt, deferConnect = false, deferSubscribe = false } = {}) {
  const state = {
    rows: [], queries: [], publications: [], errors: [], timers: new Map(),
    intervals: new Map(), listeners: new Map(), handlers: new Map(),
    disconnects: 0, unsubscribes: 0, subscribes: 0, nextTimer: 1, clientActive: false,
    tokenRefreshes: 0,
    tokenError: null,
    deleteError: null,
  };
  const connectAttempt = deferConnect ? deferred() : undefined;
  const subscribeAttempt = deferSubscribe ? deferred() : undefined;
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
    constructor(config) {
      assert.equal(config.databaseName, 'app');
      assert.equal(config.volcanoClient, volcano);
      assert.equal(config.accessToken, undefined, 'long-lived client uses getToken');
      assert.equal(typeof config.getToken, 'function');
      this.getToken = config.getToken;
      client = this;
    }
    async connect() {
      if (connectAttempt) return connectAttempt.promise;
      state.clientActive = true;
      if (failAt === 'connect') throw new Error('connect failed');
    }
    channel(name, options) {
      assert.equal(name, 'public:posts');
      assert.deepEqual({ ...options }, { type: 'postgres', databaseName: 'app' });
      return {
        onPostgresChanges(type, schema, table, callback) {
          assert.equal(schema, 'public');
          assert.equal(table, 'posts');
          state.handlers.set(type, callback);
        },
        async subscribe() {
          state.subscribes += 1;
          if (subscribeAttempt) return subscribeAttempt.promise;
          if (failAt === 'subscribe') throw new Error('subscribe failed');
        },
        unsubscribe() { state.unsubscribes += 1; },
      };
    }
    onConnect(callback) {
      this.reconnect = callback;
      return () => { this.reconnect = undefined; };
    }
    disconnect() {
      state.disconnects += 1;
      state.clientActive = false;
    }
  }
  const volcano = {
    accessToken: 'test-token',
    auth: {
      async refreshSession() {
        state.tokenRefreshes += 1;
        if (state.tokenError) return { session: null, error: state.tokenError };
        return { session: { access_token: `refreshed-${state.tokenRefreshes}` }, error: null };
      },
    },
    database(name) { assert.equal(name, 'app'); },
    delete(table) {
      assert.equal(table, 'posts');
      return {
        async eq(field, id) {
          assert.equal(field, 'id');
          if (state.deleteError) return { error: state.deleteError };
          state.rows = state.rows.filter((row) => row.id !== id);
          return { error: null };
        },
      };
    },
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
                  const rows = [...state.rows].sort((a, b) => b.created_at - a.created_at).slice(0, 50);
                  return new Promise((resolve) => state.queries.push({ resolve, rows }));
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
  vm.runInNewContext(`${example}\nglobalThis.subscription = postsSubscription;\nglobalThis.deletePostAndRefresh = deletePostAndRefresh;`, context);
  const nextQuery = async () => {
    const query = state.queries.shift();
    assert.ok(query, 'query was scheduled');
    query.resolve(failAt === 'snapshot'
      ? { error: new Error('snapshot failed') }
      : { data: query.rows, error: null });
    await flush();
  };
  const fireTimer = async () => {
    const [id, callback] = state.timers.entries().next().value ?? [];
    assert.ok(callback, 'reconciliation timer exists');
    state.timers.delete(id);
    callback();
    await flush();
  };
  return { state, client: () => client, stop: context.subscription.stop,
    reconcileAfterMutation: context.subscription.reconcileAfterMutation,
    deletePostAndRefresh: context.deletePostAndRefresh, flush, nextQuery, fireTimer,
    settleConnect(error) {
      assert.ok(connectAttempt, 'connect attempt is deferred');
      // The SDK may create its internal client after an earlier disconnect.
      state.clientActive = true;
      if (error) connectAttempt.reject(error);
      else connectAttempt.resolve();
    },
    settleSubscribe(error) {
      assert.ok(subscribeAttempt, 'subscribe attempt is deferred');
      if (error) subscribeAttempt.reject(error);
      else subscribeAttempt.resolve();
    },
    emit(type, record) { state.handlers.get(type)({ record }); } };
}

{
  const h = harness();
  assert.equal(await h.client().getToken(), 'refreshed-1');
  assert.equal(await h.client().getToken(), 'refreshed-2', 'token callback reads a fresh session');
  h.state.tokenError = new Error('refresh failed');
  await assert.rejects(h.client().getToken(), /refresh failed/);
  h.stop();
}

{
  const h = harness();
  h.state.rows = [{ id: 1, created_at: 1 }];
  await h.flush();
  await h.nextQuery();
  await h.deletePostAndRefresh(1);
  assert.equal(h.state.queries.length, 1, 'local delete starts an immediate snapshot');
  assert.equal(h.state.timers.size, 0, 'local delete does not wait for the debounce');
  await h.nextQuery();
  assert.deepEqual(h.state.publications.at(-1), [], 'deleted row disappears immediately');
  h.stop();
}

{
  const h = harness();
  h.state.rows = [{ id: 1, created_at: 1 }];
  await h.flush();
  await h.deletePostAndRefresh(1); // Delete succeeds while an older snapshot is in flight.
  await h.nextQuery();
  assert.equal(h.state.publications.length, 0, 'pre-delete snapshot cannot publish');
  assert.equal(h.state.queries.length, 1, 'mutation queues an immediate confirming snapshot');
  await h.nextQuery();
  assert.deepEqual(h.state.publications, [[]]);
  h.stop();
}

{
  const h = harness();
  await h.flush();
  await h.nextQuery();
  h.state.deleteError = new Error('delete failed');
  await assert.rejects(h.deletePostAndRefresh(1), /delete failed/);
  assert.equal(h.state.queries.length, 0, 'failed mutation does not trigger reconciliation');
  h.stop();
}

{
  const actions = [];
  const channels = new Map();
  const failure = deferred();
  const realtime = {
    channel(name, options) {
      assert.ok(['public:posts', 'public:comments'].includes(name));
      assert.deepEqual({ ...options }, { type: 'postgres', databaseName: 'app' });
      const channel = {
        onPostgresChanges(type, schema, table) {
          assert.equal(type, '*');
          assert.equal(`${schema}:${table}`, name);
        },
        async subscribe() {
          actions.push(`subscribe:${name}`);
          if (name === 'public:comments') return failure.promise;
        },
        unsubscribe() { actions.push(`unsubscribe:${name}`); },
      };
      channels.set(name, channel);
      return channel;
    },
  };
  const task = vm.runInNewContext(`(async () => {\n${multipleTablesExample}\n})()`, {
    realtime, handlePostChange() {}, handleCommentChange() {},
  });
  await flush();
  failure.reject(new Error('comments failed'));
  await assert.rejects(task, /comments failed/);
  assert.equal(channels.size, 2);
  assert.deepEqual(actions, [
    'subscribe:public:posts', 'subscribe:public:comments',
    'unsubscribe:public:posts', 'unsubscribe:public:comments',
  ], 'a sibling failure releases both channels');
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

for (const outcome of ['resolve', 'reject']) {
  const h = harness({ deferConnect: true });
  h.stop();
  h.stop();
  assert.equal(h.state.disconnects, 1, 'public cleanup is idempotent');
  h.settleConnect(outcome === 'reject' ? new Error('connect failed') : undefined);
  await h.flush();
  assert.equal(h.state.clientActive, false, `late connect ${outcome} leaves no client`);
  assert.equal(h.state.disconnects, 2, `late connect ${outcome} disconnects after settlement`);
  assert.equal(h.state.unsubscribes, 0);
  assert.equal(h.state.subscribes, 0, 'teardown prevents a late subscription');
  assert.deepEqual(h.state.errors, [], 'teardown suppresses late errors');
  assert.equal(h.state.queries.length, 0, 'teardown suppresses late queries');
  assert.equal(h.state.publications.length, 0, 'teardown suppresses late publications');
  assert.equal(h.state.listeners.size, 0);
  assert.equal(h.state.intervals.size, 0);
  assert.equal(h.state.timers.size, 0);
}

for (const outcome of ['resolve', 'reject']) {
  const h = harness({ deferSubscribe: true });
  await h.flush();
  h.stop();
  h.stop();
  h.settleSubscribe(outcome === 'reject' ? new Error('subscribe failed') : undefined);
  await h.flush();
  assert.equal(h.state.clientActive, false, `late subscribe ${outcome} leaves no client`);
  assert.equal(h.state.disconnects, 1);
  assert.equal(h.state.unsubscribes, 1);
  assert.equal(h.state.subscribes, 1);
  assert.deepEqual(h.state.errors, []);
  assert.equal(h.state.queries.length, 0);
  assert.equal(h.state.publications.length, 0);
  assert.equal(h.state.listeners.size, 0);
  assert.equal(h.state.intervals.size, 0);
  assert.equal(h.state.timers.size, 0);
}

for (const failAt of ['connect', 'subscribe', undefined]) {
  const actions = [];
  let cleanup;
  class ReactRealtime {
    async connect() {
      if (failAt === 'connect') throw new Error('connect failed');
    }
    channel() {
      return {
        onPostgresChanges() {},
        async subscribe() {
          if (failAt === 'subscribe') throw new Error('subscribe failed');
        },
        unsubscribe() { actions.push('unsubscribe'); },
      };
    }
    disconnect() { actions.push('disconnect'); }
  }
  vm.runInNewContext(reactExample, {
    useEffect(setup) { cleanup = setup(); },
    VolcanoRealtime: ReactRealtime,
    handleChange() {},
    showConnectionError(message) { actions.push(`error: ${message}`); },
  });
  await flush();
  if (failAt) {
    assert.deepEqual(actions, ['unsubscribe', 'disconnect', `error: ${failAt} failed`],
      `${failAt} failure cleans up before reporting, while mounted`);
  }
  cleanup();
  cleanup();
  assert.deepEqual(actions, failAt
    ? ['unsubscribe', 'disconnect', `error: ${failAt} failed`]
    : ['unsubscribe', 'disconnect'], 'returned cleanup is idempotent');
}

for (const stage of ['connect', 'subscribe']) {
  for (const outcome of ['resolve', 'reject']) {
    const actions = [];
    const attempt = deferred();
    let cleanup;
    let client;
    class ReactRealtime {
      constructor() { client = this; }
      async connect() {
        if (stage === 'connect') return attempt.promise;
        this.active = true;
      }
      channel() {
        return {
          onPostgresChanges() {},
          async subscribe() {
            actions.push('subscribe');
            if (stage === 'subscribe') return attempt.promise;
          },
          unsubscribe() { actions.push('unsubscribe'); },
        };
      }
      disconnect() {
        actions.push('disconnect');
        this.active = false;
      }
    }
    vm.runInNewContext(reactExample, {
      useEffect(setup) { cleanup = setup(); },
      VolcanoRealtime: ReactRealtime,
      handleChange() {},
      showConnectionError(message) { actions.push(`error: ${message}`); },
    });
    await flush();
    cleanup();
    cleanup();
    assert.deepEqual(actions, stage === 'connect'
      ? ['unsubscribe', 'disconnect']
      : ['subscribe', 'unsubscribe', 'disconnect'], 'React cleanup is idempotent');
    if (stage === 'connect') client.active = true; // Internal client appeared after cleanup.
    if (outcome === 'reject') attempt.reject(new Error(`${stage} failed`));
    else attempt.resolve();
    await flush();
    assert.equal(client.active, false, `React late ${stage} ${outcome} leaves no client`);
    assert.deepEqual(actions, stage === 'connect'
      ? ['unsubscribe', 'disconnect', 'disconnect']
      : ['subscribe', 'unsubscribe', 'disconnect'],
    `React late ${stage} ${outcome} has no error, stale subscription, or duplicate cleanup`);
  }
}

console.log('realtime example: OK (scope, token refresh, delete reconciliation, bounded publication, cleanup, late settlements)');
