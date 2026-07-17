# Agent-behavior eval harness

Checks whether a real model, given this repo's canonical `AGENTS.md` (root of
this repo) as context, actually behaves according to the response guidelines
— not just that the markdown reads correctly to a human/Copilot reviewer.

This closes a real gap: this repo had no CI at all before this harness, and
downstream consumers (`volcano-agentic-plugins`, `volcano-web`) only ever
ran structural/static checks (materialized-content drift, submodule
freshness, etc.) — nothing verified that an agent given these instructions
would, for example, correctly branch its next-step suggestion on auth/project
state, or actually stop and ask before a cloud deploy. Since both downstream
repos consume this repo's `AGENTS.md` as their single canonical source, this
harness lives here rather than being duplicated in either consumer.

## How it works

1. `tests/agent-eval/scenarios.mjs` defines scenarios: a user prompt (often
   with simulated `volcano status`-style context) plus a set of deterministic
   assertions, each traceable to a specific `AGENTS.md` rule via the `rule`
   field.
2. The runner (`scripts/eval-agent-guidance.mjs`) builds a system prompt from
   the live `AGENTS.md` content, sends each scenario's prompt to a real model,
   and checks the response against the scenario's assertions.
3. Assertions are plain string/regex checks (see
   `scripts/lib/agent-eval-assertions.mjs`) — no LLM-as-judge is required for
   the blocking checks, so results are deterministic given a fixed model
   response. An optional advisory `judge(...)` assertion type exists for
   softer semantic checks; judge results are reported but non-blocking unless
   a scenario explicitly opts in.

## Running it locally (no API key needed)

```sh
# Structural lint only — no model call at all.
pnpm eval:agent-guidance:lint

# Deterministic self-test of the assertion logic itself, using hand-written
# fixture responses (no model call at all).
pnpm eval:agent-guidance:selftest

# Live run against a real model. Defaults to the local `claude` CLI — reuses
# whatever Claude Code session you're already logged into, no API key setup
# required. Runs each scenario with tools fully disabled (`--tools ""`) from
# a scratch temp directory, so nothing it says can actually touch your repo
# or run real commands.
pnpm eval:agent-guidance
```

Override the model with `AGENT_EVAL_MODEL=<name> pnpm eval:agent-guidance` (any
`claude --model` alias/full name). Default is `sonnet` — `haiku` was observed
to hang/exceed even a generous timeout on these scenarios; `sonnet` is
reliable but each call can genuinely take 30–160s (a full `AGENTS.md` as
system prompt is large). Run a single scenario while iterating:

```sh
AGENT_EVAL_SCENARIO_FILTER=build-bare-not-authenticated pnpm eval:agent-guidance
```

To use OpenAI instead (e.g. to match what the manual diagnostic workflow
runs), set `OPENAI_API_KEY` — it's preferred automatically when present. Force a specific provider with
`AGENT_EVAL_PROVIDER=claude-cli` or `AGENT_EVAL_PROVIDER=openai`.

## CI vs. diagnostic runs

The deterministic checks are CI; the live model eval is deliberately **not**.

- **CI — every push/PR:** `.github/workflows/ci.yml` runs
  `eval:agent-guidance:lint` and `eval:agent-guidance:selftest`
  unconditionally — fast, free, no secrets, no model call. These are the
  merge-gating checks.
- **Occasional diagnostic — manual only:** `.github/workflows/agent-eval.yml`
  runs the live OpenAI eval, but only via `workflow_dispatch` (Actions tab →
  "Agent behavior eval (manual diagnostic)" → "Run workflow"). It is
  intentionally never wired to push/PR. The live run is non-deterministic (see
  below), so treat it as a tool you reach for when investigating a suspected
  behavior regression or after a substantive `AGENTS.md` change — not a gate.
  Optional inputs let you filter scenarios or pick a model; the job is skipped
  (not failed) when `OPENAI_API_KEY` isn't configured. Locally, just run
  `pnpm eval:agent-guidance`.

## Adding a scenario

1. Add a scenario object to `tests/agent-eval/scenarios.mjs`, citing the exact
   `AGENTS.md` rule it checks in the `rule` field.
2. Add a matching `compliant`/`violating` fixture pair to
   `scripts/eval-agent-guidance-selftest.mjs`. The self-test fails loudly if a
   scenario has no fixture, and fails if the compliant fixture doesn't pass or
   the violating fixture isn't caught — this keeps the assertion logic honest
   independent of any live model call.
3. Run `pnpm eval:agent-guidance:selftest` locally before opening a PR.

## Known limitation: live results are not fully deterministic

`eval:agent-guidance:lint` and `eval:agent-guidance:selftest` are fully
deterministic (no model call). The live run is a real model call and is not
— observed variance on this scenario set: the model sometimes hedges into
"once you confirm, I'll ..., then stop for your go-ahead" for actions
`AGENTS.md` explicitly marks automatic, even with an explicit
anti-hedging instruction in the harness's system framing (see
`buildSystemPrompt` in `scripts/lib/agent-eval-runner.mjs`). Treat a live-run
failure as a real signal to investigate (it may be a genuine compliance gap,
as above), not as a hard, always-reproducible regression gate. This is also
why the live eval is a manual, on-demand diagnostic (`workflow_dispatch`)
rather than a push/PR CI check — treat any failure as a lead to investigate,
never as an automatic merge block.

**Gotcha:** the `Next:` line assertions check literal `\n`-delimited lines.
Don't hand-wrap a `Next: ...` fixture string across multiple array entries in
a way that inserts a real newline in the middle of the logical line — it will
look like two lines (or a missing line) to `nextStepLines()`.
