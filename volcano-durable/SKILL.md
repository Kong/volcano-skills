---
name: volcano-durable
description: Use for Volcano durable functions, long-running or resumable workflows, checkpointed steps, waits, human approvals, messages sent to a running workflow, callbacks an external system answers with a token, live workflow progress, polling, durable executions, idempotent starts, and durable function schedulers.
---
# Volcano Durable Functions Skill

## Role and pairing

Use a durable function when work must survive restarts, wait without holding a
request open, or resume from completed steps. Examples include order pipelines,
agent runs, approval flows, workflows that wait on a webhook or a partner's
API, reconciliation jobs, and slow batch work.

Always pair this skill with:
- `volcano-sdk` for the application entrypoint and domain routing.
- `volcano-platform` for project shape, variables, config, auth, and cloud safety.

Use `volcano-functions` only when the same task also has standard synchronous
functions. The handler contracts differ.

## Core contract

- Durable functions are a separate collection from standard functions.
- Durable functions use `volcano/functions/` and are marked with `kind: durable`
  in `volcano-config.yaml`.
- A function kind is fixed when the function is created.
- Deploy locally with `volcano durable deploy` and to cloud with
  `volcano cloud durable deploy`. Standard function deploy skips manifest
  entries marked durable. `volcano deploy` and `volcano cloud deploy` deploy
  them with the rest of the project, after the standard functions.
- Start an execution. Do not invoke a durable function.
- A start returns an execution handle. Poll the execution for its result.
- JavaScript, TypeScript, and Python can author durable handlers. Ruby clients
  can start and read executions but cannot author handlers.
- Local and cloud use the same handler, manifest, and execution commands.

Use the project's language and supported capability:

| Project signal | Author durable handlers | Manage executions | SDK behavior |
|---|---|---|---|
| `package.json`, `.ts`, `.js` | JavaScript/TypeScript | JavaScript/TypeScript | camel-case methods and result envelopes |
| `pyproject.toml`, `requirements.txt`, `.py` | Python | Python | snake-case methods and typed exceptions |
| `Gemfile`, `.gemspec`, `.rb` | Use JavaScript or Python | Ruby | snake-case methods and typed exceptions |

## Authoring rule: replay must be deterministic

Each context operation is checkpointed. On resume, completed operations replay
their recorded results. Code between operations runs again.

- Put side effects and decisions that must run once inside `ctx.step`.
- Use `ctx.wait` for delays. Do not hold the runtime with timers or sleep.
- Do not branch between checkpoints on the current time, random data, or mutable
  external state.
- Give operations stable names and reach them in the same order on replay.
- Return the application result directly. Do not return the standard function
  `{ statusCode, body }` shape.

## JavaScript and TypeScript

Use a directory function so its dependency manifest stays with its source:

```text
volcano/functions/order-pipeline/
├── index.js
└── package.json
```

```json
{
  "private": true,
  "dependencies": {
    "@volcano.dev/sdk": "latest"
  }
}
```

```js
const { durable } = require('@volcano.dev/sdk/durable');

exports.handler = durable(async (input, ctx) => {
  if (!input?.order_id) throw new Error('order_id is required');

  const charge = await ctx.step('charge', () => chargeCard(input.order_id));
  await ctx.wait('settle', '30s');

  const packed = await ctx.map('pack', input.items ?? [], (item, itemCtx) =>
    itemCtx.step('pack-item', () => pack(item)),
  );

  return { charge_id: charge.id, packed: packed.results };
});
```

## Python

```text
volcano/functions/order-pipeline/
├── main.py
└── requirements.txt
```

```text
volcano-sdk
```

```python
from volcano_sdk.durable_authoring import durable


@durable
def handler(event, ctx):
    if not event or not event.get("order_id"):
        raise ValueError("order_id is required")

    charge = ctx.step("charge", lambda scope: charge_card(event["order_id"]))
    ctx.wait("settle", "30s")
    return {"charge_id": charge["id"]}
```

Python durable operations are synchronous. A step function receives its scope.

## Context operations

| Operation | Use |
|---|---|
| `ctx.step(name?, fn, options?)` | Run work and record its result. Retry policy and at-most-once behavior belong here. |
| `ctx.wait(name?, duration)` | Suspend for at least one second without holding compute. |
| `ctx.waitUntil(name?, check, options)` | Poll state until `options.until` passes. `initialState` is required. |
| `ctx.waitForApproval(name, options)` | Suspend until a person approves or denies, or the approval expires. Python takes keywords, not an options object: `ctx.wait_for_approval(name, *, title, description=None, details=None, timeout=None)`. |
| `ctx.waitForMessage(name, options?)` | Suspend until a message with that name arrives, or `options.timeout` passes and it resolves with `null`. Python: `ctx.wait_for_message(name, *, timeout=None)`, returning `None` on timeout. |
| `ctx.publish(name, data?)` | Record a message that applications list or receive live. Resolves with `{ id, seq }`. Python: `ctx.publish(name, data=None)`. |
| `ctx.waitForCallback(name, submitter, options?)` | Hand a `vcb_` token to another system and suspend until it succeeds or fails the wait, or `options.timeout` or `options.heartbeatTimeout` passes and it resolves with `null`. Python: `ctx.wait_for_callback(name, submitter, *, timeout=None, heartbeat_timeout=None)`, returning `None` on timeout. |
| `ctx.map(name?, items, fn, options?)` | Run one checkpointed child context per item. Set `concurrency` when required. |
| `ctx.parallel(name?, branches, options?)` | Run independent checkpointed branches. |
| `ctx.child(name?, fn)` | Group operations in a child context. |
| `ctx.log` | Log with execution identifiers attached. |

Each step attempt, wait, poll check, child, map item, parallel branch, and
publish uses a durable operation. Each approval, message wait, and callback
uses three. `durable get` shows the function's execution timeout and
result retention. Read the plan limits documentation for operation allowance,
operations per execution, and concurrency limits.

## Human approvals

Use `waitForApproval` when a person must sign off before the workflow continues.
The execution suspends without holding compute and resumes with the decision.
Use `ctx.waitUntil` only for state your code can read, such as a payment
settling. Do not build your own approval table and poll it.

```js
const { durable } = require('@volcano.dev/sdk/durable');

exports.handler = durable(async (input, ctx) => {
  const quote = await ctx.step('quote', () => quoteShipping(input.order_id));

  const decision = await ctx.waitForApproval('ship-order', {
    title: `Ship order ${input.order_id}?`,
    description: 'Express shipping is billed to the customer.',
    details: { order_id: input.order_id, cost: quote.cost },
    timeout: '3d',
  });
  if (!decision.approved) {
    return { shipped: false, status: decision.status, comment: decision.comment };
  }

  await ctx.step('ship', () => ship(input.order_id));
  return { shipped: true, approved_by: decision.decidedBy?.email ?? null };
});
```

```python
from volcano_sdk.durable_authoring import durable


@durable
def handler(event, ctx):
    order_id = event["order_id"]
    quote = ctx.step("quote", lambda scope: quote_shipping(order_id))

    decision = ctx.wait_for_approval(
        "ship-order",
        title=f"Ship order {order_id}?",
        details={"order_id": order_id, "cost": quote["cost"]},
        timeout="3d",
    )
    if not decision.approved:
        return {"shipped": False, "status": decision.status}

    ctx.step("ship", lambda scope: ship(order_id))
    return {"shipped": True}
```

The decision has `approved`, `status`, `comment`, `decidedBy` (`{ id, email }`
or `null`), and `decidedAt`. Python uses attributes: `decision.decided_by`
(with `id` and `email`, or `None`) and `decision.decided_at`.

| `status` | `approved` | Meaning |
|---|---|---|
| `approved` | `true` | A person approved, with an optional comment. |
| `denied` | `false` | A person denied, with an optional comment. |
| `expired` | `false` | `timeout` passed first. `comment` is empty; `decidedBy` and `decidedAt` are null. |

A deny or an expiry is a return value, not an error. Branch on
`decision.approved` and handle `expired` explicitly. An approval whose execution
ends first (stopped, failed, or timed out) shows as `cancelled` to the owner;
the workflow never receives it.

- `timeout` takes the same durations as `ctx.wait`. Without one, the approval
  lasts until the execution's own timeout.
- Give each approval a short, stable, plain-ASCII name; it is the operation's
  name in the execution's history, and the SDK refuses one longer than 237
  characters or outside printable ASCII. Replay returns the recorded decision
  and never requests the approval twice.
- Approvals work inside `ctx.parallel`, `ctx.map`, and child contexts. An
  execution can have at most 100 pending at once; the next request throws.
- Each approval is three durable operations: the approval, the wait for the
  decision, and the step that registers the request. Inside `ctx.map` that
  cost applies per item.
- Build `title` and `details` from input or step results. `title` holds up to
  200 characters, `description` 4000, and the whole request 64 KiB.
- `details` is shown to the person deciding and kept for a year. Do not put
  secrets or credentials in it.

### Who decides

A person decides, in the dashboard under **Approvals**, or from the CLI. In
local mode the local user decides without logging in:

```sh
volcano durable approvals list                  # pending, newest first
volcano durable approvals get <approval-id>
volcano durable approvals approve <approval-id> --comment "Checked stock"
volcano durable approvals deny <approval-id> --comment "Customer cancelled"
volcano durable approvals stats --since 30d
```

In cloud, the person runs `volcano login` and then the same commands under
`cloud`:

```sh
volcano cloud durable approvals list
volcano cloud durable approvals approve <approval-id> --comment "Checked stock"
```

The SDK owner clients expose the same operations under
`durable.approvals`. Project access tokens can read approvals and stats but get
`403` on approve and deny. The MCP tools `list_durable_approvals` and
`get_durable_approval_stats` only read; MCP has no way to decide.

Never approve or deny an approval yourself, including one your own workflow
requested during testing. List it, tell the user its ID and title, and let them
decide. Do not write code that decides approvals automatically; that defeats
the approval.

## Messages

Use `waitForMessage` when the workflow waits on something code reports: a
webhook, a payment provider, a button in the app, another function finishing.
Use `publish` to report progress that a browser or backend shows live. Both
need `@volcano.dev/sdk` 2.1 or `volcano-sdk-python` 0.15; Ruby can send, list,
and subscribe but not author handlers. The `volcano [cloud] durable messages`
commands need CLI 0.47.0 or later.

| Answer comes from | Use |
|---|---|
| A person who must decide | `ctx.waitForApproval` |
| Code, a webhook, or a user action in the app | `ctx.waitForMessage` |
| A system that holds no Volcano credential and can return a value when done | `ctx.waitForCallback` |
| State your code can read on its own | `ctx.waitUntil` |

A message never decides an approval. Do not replace an approval with a message
where an answer from code would defeat the sign-off, and do not use an approval
comment to pass data into a workflow. Do not poll a table with `ctx.waitUntil`
for something a sender could deliver as a message.

```js
const { durable } = require('@volcano.dev/sdk/durable');

exports.handler = durable(async (input, ctx) => {
  await ctx.publish('progress', { stage: 'waiting-for-post' });

  // Only the webhook route (service key) or the project's own credentials
  // (CLI, MCP, dashboard) may report the post.
  let posted;
  do {
    posted = await ctx.waitForMessage('posted', { timeout: '1d' });
  } while (posted !== null && !['service_key', 'project'].includes(posted.sender.type));
  if (posted === null) return { status: 'abandoned' };

  await ctx.publish('progress', { stage: 'done', url: posted.data.url });
  return { status: 'done', url: posted.data.url };
});
```

```python
from volcano_sdk.durable_authoring import durable


@durable
def handler(event, ctx):
    ctx.publish("progress", {"stage": "waiting-for-post"})

    # Only the webhook route (service key) or the project's own credentials
    # (CLI, MCP, dashboard) may report the post.
    posted = ctx.wait_for_message("posted", timeout="1d")
    while posted is not None and posted.sender.type not in ("service_key", "project"):
        posted = ctx.wait_for_message("posted", timeout="1d")
    if posted is None:
        return {"status": "abandoned"}

    ctx.publish("progress", {"stage": "done", "url": posted.data["url"]})
    return {"status": "done", "url": posted.data["url"]}
```

- A timeout is a return value, not an error. Branch on `null` (`None`).
- The message has `id`, `name`, `data`, `sender` (`type` is `service_key`,
  `user`, `anon`, or `project`; `userId` for a user), and `sentAt`. Python uses
  `sender.user_id` and `sent_at`. `project` is the owner's or a project access
  token, which the CLI, MCP, and dashboard send with.
- Messages sent before anything waits for their name are queued. Each wait
  takes the oldest one with its name, so a loop drains a burst in order. Waits
  work inside `ctx.parallel`, `ctx.map`, and child contexts.
- Replay returns the recorded message and never publishes twice. A publish
  that runs again after a crash is sent again, since the crash may have come
  before subscribers got it; `subscribe` still delivers it once.
- Names follow the approval rule: short, stable, printable ASCII, up to 237
  characters. Data is any JSON value up to 64 KiB.
- The first `publish` in each context opens a messages session: three
  operations and one resume, once. It shows in the trace as a child named
  `volcano:messages-session`. Every `ctx.map` item and `ctx.parallel` branch
  that publishes is its own context, so publish from the parent, after the map
  returns or after each batch, rather than from each item.
- Per execution: 100 queued messages, 100 open waits, 3,600 sends per hour,
  and, over its life, 1,000 published messages and 1,000 sessions.

### Who can send and read

Send, list, and subscribe with the credential the caller already has. The
function's `visibility` must admit it first, then:

| Credential | Reaches |
|---|---|
| Service key | Any execution of the project |
| Signed-in user | Executions that user started, plus any whose client token they send |
| Anon key | Only executions whose client token it sends |

Anything else gets `404`, and so does every caller but the service key while
the execution is still `pending`; send and read once it is `running`. The
start that creates an execution returns `client_token`; a repeated start under
the same name returns the same execution id but never the token. A backend
that starts with the service key can hand the token to the browser that should
follow the execution. Save the execution id where the sender can find it.

The token lets its holder send as well as read. When a message's data must
come from trusted code, such as a webhook that checked the provider's
signature, have the handler ignore other senders by `sender.type`, as the
example above does, or keep the token on the server and serve progress from a
backend route. Each ignored message costs the loop another wait and starts its
timeout over, so a token holder can keep the workflow waiting; keep the token
on the server when that matters.

Keep the service key in server-only code: a webhook route, a function, a
backend job. Send each webhook's event id as the idempotency key so provider
retries do not deliver twice.

### Send, list, and subscribe from an application

```ts
const target = {
  functionName: 'publish-post',
  executionId: execution.id,
  clientToken: execution.client_token,
};

const sent = await volcano.durable.messages.send(
  target,
  'posted',
  { url: 'https://example.com/p/42' },
  { idempotencyKey: webhookEventId },
);
if (sent.error) throw sent.error;

const { data: page } = await volcano.durable.messages.list(target, { direction: 'out' });

const { data: subscription, error } = await volcano.durable.messages.subscribe(
  target,
  (message) => showProgress(message.data),
  { realtime },
);
// Refused without a user session, with Realtime off, or past visibility.
if (error) throw error;
// On teardown
await subscription?.unsubscribe();
```

```python
client.durable.messages.send(
    "publish-post", execution.id, "posted", {"url": url},
    client_token=execution.client_token, idempotency_key=event_id,
)
page = client.durable.messages.list(
    "publish-post", execution.id, direction="out", client_token=execution.client_token,
)
# subscribe needs a client signed in as a user; see below.
subscription = await user_client.durable.messages.subscribe(
    "publish-post", execution.id, on_message, client_token=execution.client_token,
)
```

```ruby
client.durable.messages.send_message(
  "publish-post", execution.id, "posted", { url: url },
  client_token: execution.client_token, idempotency_key: event_id
)
page = client.durable.messages.list(
  "publish-post", execution.id, direction: "out", client_token: execution.client_token
)
```

`subscribe` catches up from the list, then delivers each published message
once, in `seq` order. Each live message carries the `seq` published before it
(`prev_seq`), so the SDK reads a lost one back from the list first. It needs
Realtime enabled (see `volcano-realtime`); listing works without it. A publish
with subscribers counts as one Realtime message plus one for each subscriber it
reaches, and again if it reruns after a crash; a publish nobody is subscribed
to costs nothing.

`subscribe` opens a realtime connection, which needs a user session (an
anonymous user counts). JavaScript can also connect with a service key, on a
server only. With the bare anon key, or in Python and Ruby with the service
key, it cannot subscribe, so poll `list` with `after` instead. Poll no faster than the app needs: on the application
endpoint, sends and lists share the function's rate limit with its invocations
and starts (on HOBBY, 100 requests per 10 seconds for one function and 600
across the project), and a tight loop gets `429`. Read on while `has_more` is
`true`; a page stops early once its messages carry 1 MiB of data.
Never subscribe to a raw `durable:` channel. Pass `projectId` (`project_id`)
to use the project endpoint with an owner or project access token.

A send to an ended execution fails with `409` and code `execution_not_running`;
a full queue gives `too_many_queued_messages`. JavaScript returns these in its
envelope; Python and Ruby raise a conflict error whose `code` says which.

### From the CLI and MCP

```sh
volcano durable messages waits publish-post <execution-id>
volcano durable messages send publish-post <execution-id> posted \
  --data '{"url":"https://example.com/p/42"}'
volcano durable messages list publish-post <execution-id> --direction out
```

Insert `cloud` after `volcano` for cloud. `send` takes `--data` or
`--data-file` and `--idempotency-key`; `list` takes `--direction in|out`,
`--name`, `--after`, `--limit`, and `--follow`. Every command takes `--json`.
Local message timeouts run in real time.

The MCP tools `list_durable_messages` and `list_durable_message_waits` read;
`send_durable_message` sends, so confirm it with the user first, and is
refused to a `read_only` project access token. Pass `functionId` as the function's name or id and `executionId` as the
execution's hyphenated UUID. A page too large for the tool result sets
`data_omitted: true` and `data: null` on its largest messages but keeps every
`seq` and `has_more`, so keep paging with `after`.

## Callbacks

Use `waitForCallback` when a system you do not run code in does the work and
can call back when it is done: a payment provider, a render queue, a partner's
API. The workflow hands it a `vcb_` token, and the token is the only credential
the answer needs. Use `waitForMessage` instead when your own code answers with
a credential it already holds. A provider that only sends its own signed
webhooks cannot post to the callback routes itself: put the token in the
provider's metadata and answer from a webhook receiver that verifies the
signature (see `volcano-functions`). Needs `@volcano.dev/sdk` 2.2 or
`volcano-sdk-python` 0.16; the `volcano [cloud] durable callbacks` commands
need CLI 0.55.0 or later.

```js
const { CallbackFailedError, durable } = require('@volcano.dev/sdk/durable');

exports.handler = durable(async (input, ctx) => {
  let payment;
  try {
    payment = await ctx.waitForCallback(
      'payment',
      // The token is the provider's idempotency key, so a rerun hand-off is safe.
      (token) => payments.start({ orderId: input.order_id, callbackToken: token }),
      { timeout: '1h', heartbeatTimeout: '10m' },
    );
  } catch (error) {
    if (error instanceof CallbackFailedError) {
      return { status: 'declined', reason: error.type };
    }
    throw error;
  }
  if (payment === null) return { status: 'abandoned' };
  // Whoever holds the token chooses the result, so check its shape.
  if (typeof payment?.charge_id !== 'string') throw new Error('payment result has no charge_id');

  return ctx.step('fulfil', () => fulfil(input.order_id, payment.charge_id));
});
```

```python
from volcano_sdk.durable_authoring import CallbackFailedError, durable


@durable
def handler(event, ctx):
    try:
        payment = ctx.wait_for_callback(
            "payment",
            lambda token: payments.start(order_id=event["order_id"], callback_token=token),
            timeout="1h",
            heartbeat_timeout="10m",
        )
    except CallbackFailedError as error:
        return {"status": "declined", "reason": error.type}
    if payment is None:
        return {"status": "abandoned"}
    if not isinstance(payment, dict) or not isinstance(payment.get("charge_id"), str):
        raise ValueError("payment result has no charge_id")
    return ctx.step("fulfil", lambda scope: fulfil(event["order_id"], payment["charge_id"]))
```

- It resolves with the `result` the holder sent, or with `null` (`None`) once
  `timeout` or `heartbeatTimeout` passes. A result is never `null`, so branch
  on it. Without `timeout` the wait lasts as long as the execution; without
  `heartbeatTimeout` no heartbeats are needed.
- A failure throws `CallbackFailedError`, from `@volcano.dev/sdk/durable` or
  `volcano_sdk.durable_authoring`, carrying the holder's `type` and `message`.
  Catch it to branch on `type`; uncaught, it fails the execution.
- The submitter runs in a checkpointed step after the wait opens, so the
  timeouts are already running. A replay does not run it again, but an attempt
  interrupted before the step is recorded can, with the same token. Make the
  hand-off idempotent, such as by passing the token as the job's idempotency
  key. A JavaScript submitter may return a promise, which is awaited. A Python
  submitter must be synchronous: an `async def` submitter raises `TypeError`.
  A submitter that throws raises `CallbackSubmitterError`.
- Names follow the approval rule. Callbacks work inside `ctx.parallel`,
  `ctx.map`, and child contexts. An execution holds at most 1,000 open tokens
  and is issued at most 3,600 an hour.
- Callback timeouts run in real time locally, even when plain waits resolve at
  once.

### Answer a callback

The holder sends the token to the project's API URL, with no other
authentication:

| Route | Body | Effect |
|---|---|---|
| `POST /durable-callbacks/succeed` | `{"token": "vcb_…", "result": <json>}` | The wait resolves with `result`: any JSON but `null`, up to 64 KiB. |
| `POST /durable-callbacks/fail` | `{"token": "vcb_…", "error": {"type": "CardDeclined", "message": "…"}}` | The wait throws `CallbackFailedError`. `message` is optional. |
| `POST /durable-callbacks/heartbeat` | `{"token": "vcb_…"}` | Restarts `heartbeatTimeout`. Never extends `timeout`. |

- `200` means the execution has the outcome. `202` with `delivering` means
  Volcano recorded it and will finish delivering it; do not send it again.
- A token takes one answer. Every later request gets `409`
  `callback_completed`, including a retry of the answer that went through, so
  a holder retrying after a lost response can treat it as done.
- `410` with `callback_expired` or `execution_ended` means nothing will take an
  answer; stop. `404` `callback_not_found` means no wait has the token.
- Answers and heartbeats share 3,600 an hour per token and 36,000 an hour per
  project, then `429`. Heartbeat only as often as `heartbeatTimeout` needs. A
  heartbeat `503` leaves the wait unchanged; retry it with backoff.

From the CLI, with no login or project:

```sh
volcano durable callbacks heartbeat <token>
volcano durable callbacks succeed <token> --result '{"charge_id":"ch_1"}'
volcano durable callbacks fail <token> --type CardDeclined --message "Insufficient funds"
```

Insert `cloud` after `volcano` for cloud. Pass `-` in place of the token to
read it from stdin. `succeed` takes `--result` or `--result-file`, and every
command takes `--json`. MCP has no callback tools: the token is the credential,
and the agent never holds one.

To test locally, play the external system yourself. Local and cloud deploy the
same source, so log the token only behind a variable set in
`volcano/volcano.env` and never in `volcano/cloud.env`:

```js
(token) => {
  if (process.env.LOG_CALLBACK_TOKENS === '1') console.log(`callback-token ${token}`);
  return payments.start({ orderId: input.order_id, callbackToken: token });
}
```

In Python, check `os.getenv("LOG_CALLBACK_TOKENS") == "1"`. Keep the
reference in one of those direct forms: Volcano detects it, so a function with
`variable_scope: scoped` receives the variable without listing it. Do not add
it to `variables`, where a name the cloud project does not set fails the
deploy. Add `LOG_CALLBACK_TOKENS=1` to `volcano/volcano.env`, redeploy
locally, read the token with `volcano durable logs <name> --type runtime`, and
answer it with the commands above.

## Start and manage executions from an application

`start` accepts an application credential and returns an execution handle. An
execution name makes retries idempotent. `get`, `list`, and `stop` are
owner-scoped; call them from trusted backend code with the project owner's
platform user token. Auth-user sessions, anon keys, service keys, and project
access tokens are not accepted.

### JavaScript and TypeScript

```ts
import { VolcanoClient } from '@volcano.dev/sdk';

const { data: handle, error } = await volcano.durable.start(
  'order-pipeline',
  { order_id: 4417 },
  { executionName: 'order-4417' },
);
if (error || !handle) throw error ?? new Error('Durable start returned no execution');

const owner = new VolcanoClient({
  anonKey: process.env.VOLCANO_ANON_KEY!,
  apiUrl: process.env.VOLCANO_API_URL,
  accessToken: process.env.VOLCANO_PLATFORM_TOKEN!,
});
const read = await owner.durable.get(projectId, 'order-pipeline', handle.id);
if (read.error) throw read.error;
const listed = await owner.durable.list(projectId, 'order-pipeline', { status: 'running' });
if (listed.error) throw listed.error;
const stopped = await owner.durable.stop(projectId, 'order-pipeline', handle.id);
if (stopped.error) throw stopped.error;
```

### Python

```python
import os
from volcano_sdk import VolcanoClient

owner = VolcanoClient(
    anon_key=os.environ["VOLCANO_ANON_KEY"],
    access_token=os.environ["VOLCANO_PLATFORM_TOKEN"],
)
handle = client.durable.start(
    "order-pipeline", {"order_id": 4417}, execution_name="order-4417"
)
execution = owner.durable.get(project_id, "order-pipeline", handle.id)
page = owner.durable.list(project_id, "order-pipeline", status="running")
owner.durable.stop(project_id, "order-pipeline", handle.id)
```

### Ruby

```ruby
require "volcano"

owner = Volcano::Client.new(
  anon_key: ENV.fetch("VOLCANO_ANON_KEY"),
  access_token: ENV.fetch("VOLCANO_PLATFORM_TOKEN")
)
handle = client.durable.start(
  "order-pipeline", { order_id: 4417 }, execution_name: "order-4417"
)
execution = owner.durable.get(project_id, "order-pipeline", handle.id)
page = owner.durable.list(project_id, "order-pipeline", status: "running")
owner.durable.stop(project_id, "order-pipeline", handle.id)
```

Poll `get` for live state. Listings carry the last observed state. `stop` is
asynchronous, so poll until the execution reaches a terminal status.

## Manifest

```yaml
# volcano-config.yaml
version: 1
functions:
  - name: order-pipeline
    kind: durable
    visibility: private
    variable_scope: scoped
    variables: [PAYMENTS_API_KEY]
```

Rules:
- Omitting `kind` means `standard`.
- `kind` is an assertion. Config deploy rejects a mismatch.
- Do not set `invocation_mode`, `http_auth_mode`, or `openapi_spec` on a durable
  function. Durable functions have no synchronous HTTP invocation path.
- `visibility` decides who can start executions: `private` (the default for
  new functions) admits service keys and schedulers, `authenticated` adds the
  project's signed-in users, and `public` adds anon keys with
  `functions.invoke`. No level lets an end user or anon key read results or
  stop executions.
- A declared `schedulers` list is fully synced by config deploy. Omitted entries
  are deleted.

## Local workflow

Run and verify Durable functions locally before cloud deployment:

```sh
volcano start
volcano deploy                  # or only the durable functions: volcano durable deploy --all
volcano durable get order-pipeline

volcano durable start order-pipeline \
  --input '{"order_id":4417}' \
  --name order-4417

volcano durable executions list order-pipeline --status running
volcano durable executions get order-pipeline <execution-id>
volcano durable logs order-pipeline --type runtime
```

Local execution uses one region. Waits resolve immediately so long workflows
finish quickly while still suspending and replaying checkpoints. Instant waits
cause more resumes per wall-clock minute than production, which helps expose a
step that is unsafe to replay. Set `LOCAL_DURABLE_REAL_TIME=true` before
`volcano start` when wait timing must be real. Local executions persist across
`volcano stop` and `volcano start`. Approval timeouts always run in real time,
so test expiry locally with a short `timeout`.

Local executions increment the same execution, operation, and compute counters
as cloud executions. Inspect them through `GET /projects/{id}/usage`; the CLI
has no project usage command. For `ctx.waitUntil`, `maxAttempts` directly bounds
the poll operation count, so check local usage before cloud deployment.

## Cloud workflow

Cloud deploy requires explicit user approval. Follow `volcano-platform` for
login, project selection, variables, and config deployment.

```sh
# Deploy the whole project, durable functions included, and wait until active.
volcano cloud deploy --env-file volcano/cloud.env

# Or deploy only the manifest entries marked durable.
volcano cloud durable deploy --all

# Or deploy one source. --visibility works only with -f; leave it out to keep
# the current level.
volcano cloud durable deploy -f order-pipeline --visibility authenticated

# Deployment is asynchronous. Wait for active before starting work.
volcano cloud durable get order-pipeline

volcano cloud durable start order-pipeline \
  --input '{"order_id":4417}' \
  --name order-4417

volcano cloud durable executions get order-pipeline <execution-id>
```

For local commands, use `volcano durable ...`. For cloud commands, insert
`cloud` after `volcano`. `--input` accepts an inline JSON object or a file
containing one. Omitting it means no input. `--name` is the idempotency key in
both local and cloud. Repeating the same name returns the same execution instead
of starting duplicate work.

Execution statuses are `pending`, `running`, `succeeded`, `failed`,
`timed_out`, `stopped`, and `unknown`. Fetch one execution to refresh its state.
`unknown` is terminal. Retry the start with the same execution name to recover
the same execution when possible.

## Schedulers

A durable scheduler starts an execution on each tick. It does not invoke the
function.

```sh
volcano cloud durable schedulers create order-pipeline \
  --name nightly-orders \
  --cron "0 2 * * *" \
  --input '{"scope":"nightly"}'

volcano cloud durable schedulers list order-pipeline
volcano cloud durable schedulers disable order-pipeline <scheduler-id>
volcano cloud durable schedulers enable order-pipeline <scheduler-id>
```

Schedulers require SUPERAGENT. A tick can overlap a running execution and uses the
same execution allowance, operation allowance, and concurrency cap as a manual
start.

## Safety

- Validate public-function input. Anyone with the project's anon key can spend
  execution and operation allowance on a public durable function, or on an
  `authenticated` one when anonymous sign-in is on.
- Keep execution names tied to one unit of work. A name stays reserved while
  its execution is readable.
- Keep returned results small. Persist data that must outlive result retention.
- Stopping is asynchronous and does not undo completed steps. Poll with
  `executions get` until terminal.
- Deleting a durable function removes its execution history. Confirm before
  `durable delete`, `executions stop`, or `schedulers delete`.
- `approvals list`, `get`, and `stats` are safe to run. `approvals approve` and
  `deny` are for the user alone; never run them.
- `messages list` and `messages waits` are safe to run. Send local messages
  freely while testing. Confirm before `volcano cloud durable messages send`
  or the MCP `send_durable_message` tool: each resumes a real execution, and a
  send cannot be taken back.
- Never put a service key in browser code to send messages. Start the
  execution from the server and give the browser its `client_token`. The
  function's `visibility` must still admit the browser: `authenticated` for a
  user session, which `subscribe` needs, or `public` for the bare anon key,
  which can only `list` and `send`. A visitor without an account can sign in
  as an anonymous user, but that takes only the anon key, so it leaves starts
  as open as `public`.
- Message data is stored with the execution and listed to everyone who can
  reach it. Do not put secrets or credentials in it.
- A callback token is a credential: whoever holds it can answer the wait. Hand
  it only to the system doing the work. Log it only behind the
  `LOG_CALLBACK_TOKENS` gate in Callbacks, and never set that variable in
  `volcano/cloud.env`. Do not return it, publish it, put it in approval
  details, or put it in a URL other systems record.
- Answer local callbacks freely while testing. Confirm before
  `volcano cloud durable callbacks succeed` or `fail`: each resumes a real
  execution, and an answer cannot be taken back. Confirm before a cloud
  `heartbeat` too: it keeps a real wait open past its heartbeat timeout.
- Bound `logs --follow` and `messages list --follow` with a timeout in
  agent-driven diagnostics. `messages list --follow` reads until the execution
  ends, which can be a day or more for one that waits.

## Troubleshooting

Use `volcano durable ...` for local state and `volcano cloud durable ...` for
cloud state.

1. Run `durable get <name>` with the correct prefix and inspect status.
2. For deploy failure, run `durable logs <name> --type build`.
3. For execution failure, run `durable logs <name> --type runtime`.
4. A `404` can mean the name belongs to the standard function collection, or
   the durable function is `private` and the caller isn't a service key.
5. A start during provisioning returns `409`; wait for `active`.
6. A `429` means a concurrency or durable allowance limit blocked the start.
7. A scheduler `403` can mean the project plan does not include schedulers.
8. An execution that stays `running` may be waiting on an approval, a
   message, or a callback. Check `durable approvals list --execution <execution-id>`
   and `durable messages waits <name> <execution-id>`. A callback waits until
   its holder answers or a timeout passes.
9. An approve or deny `403` means the credential is not a person's. A `409`
   means the approval was already decided, expired, or cancelled.
10. A message stuck at `queued` has a name no wait uses yet; compare it with
    `messages waits`. A send or list `404`, or a refused subscribe, means the
    caller cannot reach the execution: the function's `visibility` must admit it (`private`
    admits only service keys), an anon key or another user needs its
    `client_token`, and only the service key reaches one that is still
    `pending`.
11. A message send `409` with `execution_not_running` means the execution
    ended; `too_many_queued_messages` means 100 messages are waiting unread,
    so retry later. A `409` `callback_taken` from a wait or publish comes only
    from a modified SDK reusing a callback.
12. A start `409` with `execution_name_held` means an earlier start under that
    name failed before it began, and only the service key, the signed-in user
    who made it, or (if an anon key made it) an anon key may retry it. Start
    under a new execution name.
13. `VOLCANO_PLATFORM_API_URL` is reserved. The platform sets it on durable
    functions; a project variable with that name is rejected. A function last
    deployed before approvals existed needs one redeploy before
    `waitForMessage`, `publish`, or `waitForCallback` work.
14. `waitForCallback` raising `CallbackSubmitterError` means the submitter
    threw, or the token could not be issued: an invalid name, 1,000 open tokens
    (`too_many_callback_tokens`), or an ended execution. Transient failures
    are retried for about 30 seconds first.
15. A callback answer `409` `callback_completed` means the token was already
    answered; `410` means the wait timed out or its execution ended.

## Verification

- Validate source syntax or run the project's typecheck and unit tests.
- Confirm the manifest names every durable function with `kind: durable`.
- Run `volcano start` and `volcano deploy` (or `volcano durable deploy --all`).
- Wait for local function status `active`.
- Start one local execution with a unique idempotency name.
- If it waits on an approval, give the user its ID and ask them to decide.
- If it waits on a message, send it with `volcano durable messages send` and
  check what it published with `messages list --direction out`.
- If it waits on a callback, answer the token the submitter logged locally
  with `volcano durable callbacks succeed` or `fail`. Before any cloud deploy,
  confirm every token log sits behind `LOG_CALLBACK_TOKENS` and
  `volcano/cloud.env` does not set it.
- Poll it to a terminal status and check its result.
- Read runtime logs if the result is not `succeeded`.
- After approved cloud deployment, repeat the execution check with
  `volcano cloud durable`.

## References

- Hosting contract: `volcano-hosting/docs/public/functions/durable-functions.md`
- Approvals: `volcano-hosting/docs/public/functions/durable-approvals.md`
- Messages: `volcano-hosting/docs/public/functions/durable-messages.md`
- Callbacks: `volcano-hosting/docs/public/functions/durable-callbacks.md`
- Local guide: `volcano-hosting/docs/public/guides/durable-functions-locally.md`
- CLI contract: `volcano-cli/docs/durable-functions.md`
- Command source: `volcano-cli/internal/cmd/durable/`
