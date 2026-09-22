---
name: volcano-durable
description: Use for Volcano durable functions, long-running or resumable workflows, checkpointed steps, waits, polling, durable executions, idempotent starts, and durable function schedulers.
---
# Volcano Durable Functions Skill

## Role and pairing

Use a durable function when work must survive restarts, wait without holding a
request open, or resume from completed steps. Examples include order pipelines,
agent runs, approval flows, reconciliation jobs, and slow batch work.

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
  entries marked durable.
- Start an execution. Do not invoke a durable function.
- A start returns an execution handle. Poll the execution for its result.
- JavaScript, TypeScript, and Python can author durable handlers. Ruby clients
  can start and read executions but cannot author handlers.
- Local and cloud use the same handler, manifest, and execution commands.

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
| `ctx.map(name?, items, fn, options?)` | Run one checkpointed child context per item. Set `concurrency` when required. |
| `ctx.parallel(name?, branches, options?)` | Run independent checkpointed branches. |
| `ctx.child(name?, fn)` | Group operations in a child context. |
| `ctx.log` | Log with execution identifiers attached. |

Each step attempt, wait, poll check, child, map item, and parallel branch uses a
durable operation. `durable get` shows the function's execution timeout and
result retention. Read the plan limits documentation for operation allowance,
operations per execution, and concurrency limits.

## Manifest

```yaml
version: 1
functions:
  - name: order-pipeline
    kind: durable
    public: false
    variable_scope: scoped
    variables: [PAYMENTS_API_KEY]
```

Rules:
- Omitting `kind` means `standard`.
- `kind` is an assertion. Config deploy rejects a mismatch.
- Do not set `invocation_mode`, `http_auth_mode`, or `openapi_spec` on a durable
  function. Durable functions have no synchronous HTTP invocation path.
- `public: true` lets an anon key start executions. It does not let that key
  read results or stop executions.
- A declared `schedulers` list is fully synced by config deploy. Omitted entries
  are deleted.

## Local workflow

Run and verify Durable functions locally before cloud deployment:

```sh
volcano start
volcano durable deploy --all
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
`volcano stop` and `volcano start`. Callbacks fail locally because no callback
delivery service runs there.

Local executions increment the same execution, operation, and compute counters
as cloud executions. Inspect them through `GET /projects/{id}/usage`; the CLI
has no project usage command. For `ctx.waitUntil`, `maxAttempts` directly bounds
the poll operation count, so check local usage before cloud deployment.

## Cloud workflow

Cloud deploy requires explicit user approval. Follow `volcano-platform` for
login, project selection, variables, and config deployment.

```sh
# Deploy every manifest entry marked durable.
volcano cloud durable deploy --all

# Or deploy one source. Visibility flags work only with -f.
volcano cloud durable deploy -f order-pipeline --private

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

Schedulers require Pro. A tick can overlap a running execution and uses the
same execution allowance, operation allowance, and concurrency cap as a manual
start.

## Safety

- Validate public-function input. Anyone with the project's anon key can spend
  execution and operation allowance on a public durable function.
- Keep execution names tied to one unit of work. A name stays reserved while
  its execution is readable.
- Keep returned results small. Persist data that must outlive result retention.
- Stopping is asynchronous and does not undo completed steps. Poll with
  `executions get` until terminal.
- Deleting a durable function removes its execution history. Confirm before
  `durable delete`, `executions stop`, or `schedulers delete`.
- Bound `logs --follow` with a timeout in agent-driven diagnostics.

## Troubleshooting

Use `volcano durable ...` for local state and `volcano cloud durable ...` for
cloud state.

1. Run `durable get <name>` with the correct prefix and inspect status.
2. For deploy failure, run `durable logs <name> --type build`.
3. For execution failure, run `durable logs <name> --type runtime`.
4. A `404` can mean the name belongs to the standard function collection.
5. A start during provisioning returns `409`; wait for `active`.
6. A `429` means a concurrency or durable allowance limit blocked the start.
7. A scheduler `403` can mean the project plan does not include schedulers.

## Verification

- Validate source syntax or run the project's typecheck and unit tests.
- Confirm the manifest names every durable function with `kind: durable`.
- Run `volcano start` and `volcano durable deploy --all`.
- Wait for local function status `active`.
- Start one local execution with a unique idempotency name.
- Poll it to a terminal status and check its result.
- Read runtime logs if the result is not `succeeded`.
- After approved cloud deployment, repeat the execution check with
  `volcano cloud durable`.

## References

- Hosting contract: `volcano-hosting/docs/public/functions/durable-functions.md`
- Local guide: `volcano-hosting/docs/public/guides/durable-functions-locally.md`
- CLI contract: `volcano-cli/docs/durable-functions.md`
- Command source: `volcano-cli/internal/cmd/durable/`
