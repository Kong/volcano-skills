# Volcano — Agent Instructions

> Canonical instruction file for coding agents using **Volcano** to build, deploy, and operate services.

Volcano is a hosting platform for deployable services: serverless functions, frontends,
databases, storage, and realtime — driven primarily through the **`volcano` CLI**.

## Prerequisites

Before any Volcano work, establish where your instructions/skills come from, then
make sure the `volcano` CLI is available.

1. **Locate your instruction/skills source — check this first, always:**
   - **Plugin-shipped (the common case):** if this `AGENTS.md` sits in a directory
     that also contains an `index.json` and sibling `volcano-*/SKILL.md` folders
     (Cursor, Claude Code, Claude Desktop, and Codex plugin installs ship this
     layout), **you are already reading the primary canonical content.** Use this
     file and those sibling skills directly. Do **not** run any `curl`/download
     command to fetch plugin skills — they are already carried by the plugin.
     There is no separate fallback copy to maintain: the plugin content on disk
     is the source of truth.
   - **Bootstrap/manual install:** only if there is no such sibling `skills/`
     layout (a bare terminal, or a harness without plugin support) do you need
     to fetch instructions/skills yourself — use the bootstrap fallback in step 3,
     which writes them under `~/.volcano/`.

2. **Ensure the CLI**: run `which volcano`.
   - **Found:** run `volcano upgrade` — it does its own version check and is a
     no-op when already current, so you never determine the version yourself.
   - **Missing:** install it. The `volcano-sdk` and `volcano-platform` skills
     carry the canonical check-and-install flow, and the `install-volcano`
     skill exposes it as an explicit command: fetch
     `https://raw.githubusercontent.com/Kong/volcano-cli/main/docs/installation.md`
     and run whichever documented method matches a package manager already on
     `PATH` (`npm`/`pnpm`/`bun`/`brew`), falling back to the documented manual
     `curl` install only if none are present. In a bare no-plugin environment,
     the bootstrap fallback in step 3 installs the CLI too. Re-run
     `which volcano` to confirm.

3. **Bootstrap fallback** (only for the no-plugin case in step 1, or when the
   CLI still isn't available): `bootstrap.sh` is hosted
   in `Kong/volcano-agentic-plugins`, not the Volcano web app — its URL is
   stable regardless of environment. It fetches `AGENTS.md`/skills from
   `VOLCANO_WEB_URL` if set (an IDE/environment may already export it for the
   target environment), defaulting to production (`https://volcano.dev`) only
   when unset. Never hardcode a different literal origin in its place. The
   script runs immediately — there is no plan/dry-run mode.
   ```sh
   set -eu
   export VOLCANO_WEB_URL="${VOLCANO_WEB_URL:-https://volcano.dev}"
   export VOLCANO_WEB_URL="${VOLCANO_WEB_URL%/}"
   curl -fsSL "https://raw.githubusercontent.com/Kong/volcano-agentic-plugins/main/scripts/bootstrap.sh" | sh
   ```

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
Authorization Grant — the CLI polls in a loop and will appear to "hang" for tens of
seconds to minutes. **This is expected.** Do not kill it.

When you see the `Code:` and browser URL in the output, immediately surface them to
the user using this format (its own message, URL on its own line):

```
------------------------------------------------------------
ACTION REQUIRED — Volcano CLI authentication

  Code:  XXXX-XXXX

  Open in your browser and approve:
  ${VOLCANO_WEB_URL:-https://volcano.dev}/device?user_code=XXXX-XXXX
------------------------------------------------------------
```

Read the **full stdout** before acting — many harnesses truncate output. Do not
paraphrase or bury the URL. Wait for `volcano login` to return (exit = success).

**Do not** search for tokens on the filesystem, probe API endpoints, `strings` the
binary, run under `timeout`, or attempt to approve a device code programmatically.
There is no shortcut — only a human with a browser session can approve.

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
3. Deploy the relevant built resources locally: `volcano functions deploy
   --all`, `volcano variables deploy`, `volcano config deploy`, `volcano
   migrations deploy --all -d app` (only the pieces relevant to what was
   built).
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
`volcano functions list`, `volcano variables deploy`, and `volcano functions
deploy --all`. Cloud mode is only the corresponding `volcano cloud ...` command
surface.

**Never auto-deploy to the cloud.** The local default above does not extend to
cloud in any case: `volcano cloud ...` commands are only run when the user
explicitly requests a cloud deployment, regardless of how automatically the
local steps ran.

**Cloud deploy** (only when the user explicitly requests cloud deployment): verify
(1) CLI is authenticated (`volcano status`), (2) a project exists and is selected
(`volcano projects list`, then `volcano use <id-or-name>`). **Cloud deploys
require explicit user confirmation**, with no exceptions.

### Suggest the next step

After finishing any stage of work — build, local run/test, local deploy, or
cloud deploy — end your response with one concrete next-step suggestion. Only
suggest it; never run it yourself. Put it on its own line, after a blank line,
formatted as `Next: <action>` so it reads as a clean, separate suggestion
rather than folded into the summary of what was just done, for example:

```
Next: run it locally with `volcano start`, `volcano functions deploy --all`,
then call the new function through the local API at http://localhost:8000.
```

Pick the single suggestion that matches where the user is in the build → local
run/test/deploy → cloud deploy progression, keep it specific to what was
actually built (skip resources that weren't touched, such as database
commands when no database was used), and use exact CLI commands:

- After the default **build → local run/test/deploy** flow: suggest cloud
  deploy, but check state first with `volcano status` (auth **and** selected
  project) and branch on exactly what's missing:
  - Not logged in: "Next: sign in with `volcano login`, then select a project
    with `volcano projects list` and `volcano use <id-or-name>`, then deploy
    to the cloud with `volcano cloud functions deploy --all`."
  - Logged in but no project selected: "Next: select a project with `volcano
    projects list` and `volcano use <id-or-name>`, then deploy to the cloud
    with `volcano cloud functions deploy --all`."
  - Logged in with a project already selected: "Next: deploy this to the
    cloud with `volcano cloud functions deploy --all`."
- After a **build-only** change (scope explicitly limited by the user, or by a
  project/user instruction file that disables auto-run/auto-deploy): suggest
  running it locally, e.g. "Next: run it locally with `volcano start`,
  `volcano functions deploy --all`, then call the new function through the
  local API."
- After a **cloud deploy**: suggest verification with exactly one method, not
  a menu of options, e.g. "Next: check it with `volcano cloud functions logs
  <name>`."

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
3. **Check logs for the specific resource**: `volcano functions logs <name> --type
   build|runtime`. `--follow` streams indefinitely like `tail -f` — only use it bounded
   (e.g. `timeout 15 volcano functions logs <name> --type runtime --follow`); a bare
   synchronous `--follow` call hangs until the harness's own timeout kills the turn.
4. **Search the bundled docs** instead of repeatedly guessing flags via `--help`:
   `volcano docs search "<topic or error text>"` (works offline from a local cache with
   `--offline`; `volcano docs list` / `volcano docs get <doc>` for full text).
5. **Check the relevant skill's "Common Errors" or "Forbidden Patterns" section** for
   the domain involved (auth/database/functions/storage/realtime) — most known failure
   modes are already catalogued there.
6. Only after 1–5 come up empty, treat it as a real blocker: report exactly what was
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

## Safety model

**Automatic when relevant to the user's requested scope (no confirmation needed):**
- Inspect: `volcano status`, `volcano projects list`, `volcano projects get <id>`
- Scaffold: `volcano init`, `volcano storage bucket create <name>` (local only — creating a bucket needed for what was built is local scaffolding like `volcano init`; cloud bucket creation follows the cloud-deploy confirmation below)
- List/get: `volcano functions list|get`, `volcano variables list|get`, `volcano databases list|get`, `volcano storage bucket list|get`
- Logs: `volcano functions logs <name> --type build|runtime`
- Local dev: `volcano start|stop|restart|status` — automatic by default after building (see "Build vs. run/test/deploy"), and whenever the user asks to run/test/preview locally
- Local deploy: `volcano functions deploy`, `volcano variables deploy`, `volcano config deploy`, `volcano migrations deploy --all -d app` — automatic by default after building, and whenever the user asks to run/test/preview locally

**Confirm-first:**
- Cloud deploys: `volcano cloud functions deploy`, `volcano cloud frontends deploy`, `volcano cloud config deploy`, `volcano cloud variables deploy`
- Deletions: any `... delete` (local or cloud)
- Secret / variable changes: `volcano cloud variables deploy`
- Permission / visibility changes: `volcano cloud functions update --public|--private`, storage policies, custom domains
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
volcano login | logout | projects list | projects get <id> | use <id-or-name>

# Scaffold
volcano init [javascript|nextjs|python|ruby]

# Local development (targets local dev server)
volcano start|stop|restart|status
volcano functions deploy --all | deploy -f <name> | list | get | logs
volcano variables deploy | list | get
volcano config deploy
volcano databases list|get
volcano storage bucket list|get
volcano migrations deploy --all -d app

# Cloud (requires login + use)
volcano cloud functions deploy --all
volcano cloud frontends deploy --name <name> --path <dir> | list | logs
volcano cloud variables deploy
volcano cloud config deploy
```

> `volcano local ...` and `volcano frontends ...` are deprecated aliases.

## Skills

Detailed workflows ship as **skills** in the active Volcano plugin or, for bootstrap installs, under `~/.volcano/skills/<name>/SKILL.md`.
Always consult `volcano-platform` (project shape / deploy contract) and `volcano-sdk`
(SDK entrypoint/router) before writing code for a Volcano project.
