# Volcano — Agent Instructions

> Canonical instruction file for coding agents using **Volcano** to build, deploy, and operate services.

Volcano is a hosting platform for deployable services: serverless functions, frontends,
databases, storage, and realtime — driven primarily through the **`volcano` CLI**.

## Prerequisites

Before any Volcano work, establish where your instructions/skills come from, then
make sure the `volcano` CLI is available.

1. **Locate your bundled instructions and skills:** if this `AGENTS.md` sits
   beside `index.json` and sibling `volcano-*/SKILL.md` folders, use that content
   directly. Do not download replacement instructions or update the plugin as
   a prerequisite to building. When the user requests a plugin update, use the
   host's supported update process and report any restart needed to apply it.
   If the skills are unavailable, report the missing prerequisite and direct
   the user to the official plugin installation documentation; do not fetch
   and execute a bootstrap script.

2. **Check the CLI**: run `which volcano` and `env -u VOLCANO_GITHUB_RELEASES_URL -u VOLCANO_CLI_RELEASES_URL volcano --version`.
   Keep both release-source overrides cleared for every CLI invocation and npm
   install in this workflow, including deferred binary downloads.
   Use an existing working version without automatic upgrades. When missing,
   or when an upgrade is explicitly requested, follow the bundled
   `install-volcano/SKILL.md`: use a verified official npm package with an
   exact version and integrity metadata. Never run network-fed shell scripts
   or execute installation instructions fetched from a moving branch. If the
   trusted installation procedure cannot be completed, report the missing
   prerequisite rather than falling back to unchecked installation.

3. This plugin already includes its instructions and skills. Do not run a
   bootstrap script or download replacement skills from the network. Use the
   host's normal plugin update process when the user requests an update.

## CLI-first

**For any Volcano-related action, check whether the CLI has a supporting command before
falling back to manual file edits or API calls.** Use `volcano <area> --help` to discover
flags before guessing. For anything beyond flag discovery — concepts, error messages, or
which command to use — run `volcano docs search "<topic>"` once (`volcano docs get <doc>`
for full text, `volcano docs list` for the index) instead of guessing across repeated
`--help` calls; see "Troubleshooting" below for the full escalation order.

### Building a new project

Always run `volcano init` **first**, before writing any code. `volcano init`
creates the base scaffold only. Use `volcano init javascript` for the JavaScript
function/config template, or `volcano init nextjs`, `volcano init python`, or
`volcano init ruby` for framework/language-specific templates. Add
`--example notes` (or `--example hello-world`) for a demo. After init, use the
`volcano-platform` skill to build the application code on top of the scaffold.

If `volcano init` is skipped, deploy commands will fail to find the expected scaffold.

### Authenticating

`volcano login` is the **only** way to authenticate. It uses an OAuth 2.0 Device
Authorization Grant: the CLI prints a `Code:` and a browser URL almost immediately,
then **blocks, polling in a loop for tens of seconds to minutes** until a human
approves in the browser. **This is expected. Do not kill it.**

**Run it in the background so you can surface the code while it polls — never as a
blocking foreground call.** A foreground `volcano login` traps its output inside the
still-running command: you never see the `Code:`/URL, can't relay it, and your turn
just hangs until it times out. Instead:

1. Start `volcano login` as a **background** command that does not block your turn
   (Claude Code: the Bash tool's `run_in_background: true`; other harnesses: their
   async/background exec).
2. Poll its streaming output (Claude Code: `BashOutput`) until the `Code:` and
   browser URL appear — read the **full** output, since many harnesses truncate.
3. **Immediately** surface them to the user in this format (its own message, URL on
   its own line):

```
------------------------------------------------------------
ACTION REQUIRED — Volcano CLI authentication

  Code:  XXXX-XXXX

  Open in your browser and approve:
  ${VOLCANO_WEB_URL:-https://volcano.dev}/device?user_code=XXXX-XXXX
------------------------------------------------------------
```

4. Then keep reading the background command until it exits; a zero exit means the
   user approved and you're now authenticated. Don't paraphrase or bury the URL.

**Offer login *or* signup.** A brand-new user can run `volcano signup` instead — it
runs the same device flow, and either browser page lets the user switch (the login
page links to sign-up and the signup page to log-in) and still finish the *same*
authorization. So when someone isn't authenticated, offer both; whichever they pick
completes the login the CLI is polling for.

**Do not** search for tokens on the filesystem, probe API endpoints, `strings` the
binary, run `volcano login` under `timeout` or as a foreground call you then kill, or
attempt to approve a device code programmatically. There is no shortcut — only a
human with a browser session can approve.

If you cannot reach the user, surface this and stop.

### Build vs. run/test/deploy

Treat a bare request to **build** something (for example, "build a todo API") as a
request to create or update the project files, then by default keep going
automatically through local run, local deploy, and a quick local test — do not
stop and wait to be asked. Local mode only ever targets `http://localhost:8000`
and never touches cloud/production resources, so this default is safe:

1. Run non-deploying validation when available, such as typecheck, lint, unit
   tests, or `npm run build:functions`.
2. Start local services: `volcano start`.
3. Deploy the project locally with `volcano deploy`. Add `--with-migrations`
   when `volcano/migrations/` holds files to apply. It deploys variables,
   migrations, functions, durable functions, frontends, and
   `volcano-config.yaml` in that order, skipping whatever the project lacks,
   then waits up to 30 minutes for the deployments to finish (see
   `volcano-platform`). `volcano deploy` needs CLI 0.46.0 or later. On an
   older CLI, deploy the pieces with the step-by-step commands in
   `volcano-platform` instead, and suggest upgrading the CLI in `Next:`.
   Below 0.45.0, never run `volcano frontends deploy`: it deploys to the
   cloud there.
4. Exercise what was built through the local API at `http://localhost:8000`
   (for example, invoke the new function) and report the result.

Only stop at build + validation (skip steps 2–4) when:
- the user's request explicitly limits scope to writing/updating code only
  (for example, "just write the code, don't run it" or "build but don't run or
  deploy it"), or
- a project- or user-level instruction file outside this plugin's canonical
  skills (for example, a repo-root `AGENTS.md`/`CLAUDE.md`) explicitly
  disables auto-run/auto-deploy. Repo- and user-level instructions always take
  precedence over this default.

Local mode means Volcano CLI commands **without** the `cloud` prefix, such as
`volcano deploy`, `volcano functions list`, and `volcano variables deploy`.
Cloud mode is only the corresponding `volcano cloud ...` command surface.

**Never auto-deploy to the cloud; always ask first.** The local default above does
not extend to cloud: run any `volcano cloud ...` deploy only after asking the user
and getting their go-ahead, regardless of how automatically the local steps ran. The
sole exception is a standing instruction from the user to deploy without asking (e.g.
"deploy to cloud automatically", "push to prod without confirming") — honor that when
given, but never infer it.

**Cloud deploy** (only when the user explicitly requests cloud deployment). Cloud is
never the *first* deploy: the autonomous default deploys and tests **locally** first
(see "Build vs. run/test/deploy"); cloud comes only after the local run clears and
the user explicitly asks for it. Then run these in order:

1. **Auth** — run `volcano projects list` (an authenticated cloud command; `volcano
   status` shows only the *local* stack, not cloud auth, so it never tells you
   whether you're logged in). If not authenticated, authenticate first (see
   "Authenticating" — offer login or signup).
2. **Project context** — a cloud project must be selected. `volcano projects list`
   shows what exists and which is current. If none is selected — or none exists at
   all (a fresh account lists zero projects) — **create one** with `volcano projects
   create <name>` (a sensible name derived from the app/directory), then `volcano
   use <id-or-name>` to select it. Don't skip this: `volcano cloud deploy`
   fails without a real, selected cloud project.
3. **Deploy** — `volcano cloud deploy --env-file volcano/cloud.env` against that
   project. `volcano/volcano.env` holds the local server's URL and keys, and a
   cloud deploy refuses it; put the cloud project's values in
   `volcano/cloud.env` first, after checking Git ignores it (see
   `volcano-platform`). Migrations are not tracked, so every
   `--with-migrations` run applies every file again; pass
   `--with-migrations -d <database>` only when the user agrees the migrations
   should run on that cloud database, and once it shows `active` in
   `volcano cloud databases get <database>`. On a CLI older than 0.46.0, run
   the per-step cloud commands in `volcano-platform` instead.

**Ask before deploying** — get the user's explicit go-ahead before running step 3
(and the `volcano projects create` in step 2, since it's part of carrying out that
one confirmed cloud deploy), unless they've given a standing instruction to skip the
confirmation.

### Suggest the next step

After finishing any stage of work — build, local run/test, local deploy, or
cloud deploy — end your response with one concrete next-step suggestion. Only
suggest it; never run it yourself. Put it on its own line, after a blank line,
formatted as `Next: <action>` so it reads as a clean, separate suggestion
rather than folded into the summary of what was just done, for example:

```
Next: run it locally with `volcano start` and `volcano deploy`, then call the
new function through the local API at http://localhost:8000.
```

Pick the single suggestion that matches where the user is in the build → local
run/test/deploy → cloud deploy progression, keep it specific to what was
actually built (skip resources that weren't touched, such as database
commands when no database was used), and use exact CLI commands:

- After the default **build → local run/test/deploy** flow: suggest cloud
  deploy, but check state first with `volcano projects list` (it both confirms
  cloud auth — `volcano status` shows only the local stack — and lists the
  projects) and branch on exactly what's missing:
  - Not logged in: "Next: sign in with `volcano login` (or `volcano signup` to
    create an account), then select or create a project with `volcano projects
    list` / `volcano projects create <name>` and `volcano use <id-or-name>`, then
    deploy to the cloud with `volcano cloud deploy --env-file volcano/cloud.env`."
  - Logged in but no project selected: "Next: select a project with `volcano
    projects list` and `volcano use <id-or-name>` (or `volcano projects create
    <name>` if you have none yet), then deploy to the cloud with `volcano cloud
    deploy --env-file volcano/cloud.env`."
  - Logged in with a project already selected: "Next: deploy this to the
    cloud with `volcano cloud deploy --env-file volcano/cloud.env`."
- After a **build-only** change (scope explicitly limited by the user, or by a
  project/user instruction file that disables auto-run/auto-deploy): suggest
  running it locally, e.g. "Next: run it locally with `volcano start` and
  `volcano deploy`, then call the new function through the local API."
- After a **cloud deploy**: suggest verification with exactly one method, not
  a menu of options, e.g. "Next: check it with `volcano cloud functions logs
  <name>`."
- On a CLI older than 0.46.0, suggest the upgrade before anything else, e.g.
  "Next: upgrade the Volcano CLI to 0.46.0 or later so `volcano deploy`
  deploys the whole project, including frontends, in one run." Suggest it
  only; upgrading is the user's call (see `install-volcano`).

Suggesting a cloud deploy here is not permission to run it — it still requires
explicit user confirmation per the safety model below.

## Troubleshooting

When a command fails, a deploy doesn't behave as expected, or output looks wrong, work
through this order before rewriting code or asking the user to check something manually:

1. **Read the full failure** — the exact error line and exit code, not a truncated
   summary; harnesses often truncate output, and Volcano CLI errors are usually specific
   (e.g. "is the volcano-server container running?").
2. **Check state**: `volcano status` (local) or `volcano projects get <id>` (cloud) —
   confirms services, project, and credentials before anything else.
3. **Local mode only — reset local state if authed local calls fail or the DB looks
   wrong.** If local commands fail with auth/database errors after the stack has been
   running a while (e.g. `401: authorization header required` on every authenticated
   call, or a database that should exist doesn't), run `volcano reset` — it drops the
   local databases, clears local platform data, and re-provisions default local
   metadata while keeping containers running. It is the purpose-built local-state
   recovery: try it (it's destructive to local data, so confirm with the user first)
   *before* manually restarting, wiping Docker volumes, or deleting `~/.volcano` state
   files. Re-deploy migrations afterward (`volcano migrations deploy --all -d app`).
4. **Check logs for the specific resource**: `volcano functions logs <name> --type
   build|runtime`. `--follow` streams indefinitely like `tail -f` — only use it bounded
   (e.g. `timeout 15 volcano functions logs <name> --type runtime --follow`); a bare
   synchronous `--follow` call hangs until the harness's own timeout kills the turn. The
   same goes for `volcano [cloud] durable messages list --follow`, which reads until the
   execution ends.
5. **Search the bundled docs** instead of repeatedly guessing flags via `--help`:
   `volcano docs search "<topic or error text>"` (works offline from a local cache with
   `--offline`; `volcano docs list` / `volcano docs get <doc>` for full text).
6. **Check the relevant skill's "Common Errors" or "Forbidden Patterns" section** for
   the domain involved (auth/database/functions/storage/realtime) — most known failure
   modes are already catalogued there.
7. Only after 1–6 come up empty, treat it as a real blocker: report exactly what was
   checked and ask the user, rather than continuing to guess with new code.

**Never open volcano.dev (or any Volcano web page) in a browser to diagnose a local
CLI, API, or SDK problem.** The website has no visibility into your local Docker
services, deployed code, or terminal output, and you cannot usefully drive a browser
session to debug from here. This rule is about diagnosis specifically — it does not
cover the handful of one-time dashboard configuration steps documented elsewhere with
no CLI equivalent yet (for example `volcano-realtime`'s CORS allowed-origins setup),
which remain legitimate. For diagnosing a problem, the human's device-code approval
during `volcano login`/`volcano signup` is the only browser step in this workflow —
never a diagnostic detour.

## Reporting Volcano problems

When you hit a problem with Volcano itself during a task, such as a CLI bug,
docs or a skill that disagree with the CLI, a missing command that forced a
workaround, a server error that repeats, or conflicting Volcano instructions,
note it and keep working. Keep the exact error text, with names from the
user's project replaced by placeholders. Whenever a `volcano` command prints a
first-run notice (a `Note:` about usage data and feedback reports), show it to
the user in your final message, even when you have nothing to report: it is
printed only once per machine. After the task, file each problem with `volcano
feedback` from a background agent, as the `volcano-feedback` skill describes.
Do not report bugs in the user's own code.

## Safety model

**Automatic when relevant to the user's requested scope (no confirmation needed):**
- Inspect: `volcano status`, `volcano projects list`, `volcano projects get <id>`
- Scaffold: `volcano init`, `volcano storage bucket create <name>` (local only — creating a bucket needed for what was built is local scaffolding like `volcano init`; cloud bucket creation follows the cloud-deploy confirmation below)
- List/get: `volcano functions list|get`, `volcano variables list|get`, `volcano databases list|get`, `volcano storage bucket list|get`
- Logs: `volcano functions logs <name> --type build|runtime`
- Feedback: filing a report with `volcano feedback` after a task, for Volcano problems you hit (see "Reporting Volcano problems"). `volcano feedback enable` and `volcano feedback disable` are the user's choice: run them only when the user asks or confirms
- Durable messages (CLI 0.47.0 or later): `volcano [cloud] durable messages list|waits`, and `volcano durable messages send` against local executions while testing
- Durable callbacks (CLI 0.55.0 or later): `volcano durable callbacks succeed|fail|heartbeat` against local executions while testing
- Local dev: `volcano start|stop|restart|status` — automatic by default after building (see "Build vs. run/test/deploy"), and whenever the user asks to run/test/preview locally
- Local deploy: `volcano deploy [--with-migrations]`, or one piece with `volcano functions deploy`, `volcano durable deploy`, `volcano variables deploy`, `volcano config deploy`, `volcano migrations deploy --all -d app` — automatic by default after building, and whenever the user asks to run/test/preview locally. `volcano frontends deploy` is automatic only on CLI 0.45.0 or later; on older CLIs it deploys to the cloud project, so it is confirm-first there.

**Confirm-first:**
- Cloud deploys: `volcano cloud deploy`, `volcano cloud functions deploy`, `volcano cloud frontends deploy` (including `--from`, which deploys another frontend's build), `volcano cloud config deploy`, `volcano cloud variables deploy`
- Cloud durable messages (CLI 0.47.0 or later): `volcano cloud durable messages send`, and the MCP `send_durable_message` tool (each resumes a real execution; a send cannot be taken back)
- Cloud durable callbacks (CLI 0.55.0 or later): `volcano cloud durable callbacks succeed|fail|heartbeat` (`succeed` and `fail` each resume a real execution, and an answer cannot be taken back; `heartbeat` keeps a real wait open past its heartbeat timeout)
- Cloud service keys: `volcano projects keys service create` (a new credential that bypasses row-level security)
- Cloud project creation: `volcano projects create` (a cloud resource; ask first, including when it's the project-context step of a cloud deploy)
- Cloud database changes: `volcano cloud databases create`, `volcano cloud databases migration up` (migrations are not tracked, so it re-applies every file)
- Deletions: any `... delete` (local or cloud)
- Local data reset: `volcano reset` (drops all local databases + local platform data; local-only but destructive and not recoverable — confirm first, then re-deploy migrations)
- Secret / variable changes: `volcano cloud variables deploy -f volcano/cloud.env`
- Permission / visibility changes: `volcano cloud functions update --visibility`, `volcano cloud frontends routes`, storage policies, custom domains, verified domains (`volcano cloud domains verify|remove`)
- Billing / account changes: plan changes, account promotion

When in doubt, treat the action as confirm-first.

## Machine-readable usage

Use machine-readable flags only when the specific command help advertises them;
`--json` and `--non-interactive` are not currently global flags. Use `--yes` only
when the command help advertises it, primarily delete commands, and only after
explicit user approval. Check exit codes; non-zero means failure.

## Command surface

```bash
# Auth & project
volcano login | signup | logout | projects list | projects create <name> | projects get <id> | use <id-or-name>

# Scaffold
volcano init [javascript|nextjs|python|ruby]

# Local development (targets local dev server)
volcano start|stop|restart|status
volcano reset [--yes]                      # DESTRUCTIVE: drop local DBs + re-provision local state (local-recovery; confirm first)
volcano deploy [--with-migrations]         # CLI 0.46.0+: whole project: variables, migrations, functions, durable, frontends, config
volcano functions deploy --all | deploy -f <name> | list | get | logs
volcano durable deploy --all
volcano durable messages list | waits <function> <execution-id>   # CLI 0.47.0+
volcano durable messages send <function> <execution-id> <message-name> --data <json>
volcano durable callbacks succeed <token> --result <json> | fail <token> --type <type> | heartbeat <token>   # CLI 0.55.0+
volcano frontends deploy --name <name> --path <dir> | list | get | logs | routes   # CLI 0.45.0+; older CLIs deploy to the cloud
volcano variables deploy | list | get
volcano config deploy
volcano databases list|get
volcano storage bucket list|get
volcano migrations deploy --all -d app

# Cloud (requires login + use)
volcano cloud deploy --env-file volcano/cloud.env [--with-migrations -d <database>]   # CLI 0.46.0+
volcano cloud functions deploy --all
volcano cloud durable messages list | waits <function> <execution-id>   # CLI 0.47.0+
volcano cloud durable messages send <function> <execution-id> <message-name> --data <json>   # confirm first
volcano cloud durable callbacks succeed <token> --result <json> | fail <token> --type <type> | heartbeat <token>   # CLI 0.55.0+; no login needed; confirm first
volcano projects keys service create <name> --permission <permission> --json   # new credential; confirm first
volcano cloud frontends deploy --name <name> --path <dir> | list | logs
volcano cloud frontends deploy <target> --from <frontend>[@<deployment-id>]   # CLI 0.51.0+: deploy another frontend's build
volcano cloud variables deploy -f volcano/cloud.env
volcano cloud databases create <database> --region <region> --pg-version 16 | get <database>
volcano cloud databases migration up --all -d <database>
volcano cloud config deploy
volcano cloud domains list | verify <domain> | remove <domain>   # domains your account owns, for custom domains

# Feedback (see the volcano-feedback skill)
volcano feedback --input -                 # file a Volcano problem after a task (report JSON on stdin)
volcano feedback status                    # check whether reports are sent
volcano feedback enable | disable          # the user's choice: only when the user asks or confirms
```

> `volcano local ...` is a deprecated alias. Before CLI 0.45.0, so is
> `volcano frontends ...`, for `volcano cloud frontends ...`.

## Skills

Detailed workflows ship as **skills** in the active Volcano plugin or, for bootstrap installs, under `~/.volcano/skills/<name>/SKILL.md`.
Always consult `volcano-platform` (project shape / deploy contract) and `volcano-sdk`
(SDK entrypoint/router) before writing code for a Volcano project.
