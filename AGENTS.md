# Volcano — Agent Instructions

> Canonical instruction file for coding agents using **Volcano** to build, deploy, and operate services.

Volcano is a hosting platform for deployable services: serverless functions, frontends,
databases, storage, and realtime — driven primarily through the **`volcano` CLI**.

## Prerequisites

Before any Volcano work, verify the CLI and skills are available:

1. **Check CLI**: run `which volcano`. If not found and you are running from a
   Volcano IDE/plugin installation, run the plugin command/skill named
   `install-volcano` (for example `/install-volcano` or `/volcano:install-volcano`).
   It installs the CLI without re-downloading plugin-shipped skills. If no plugin
   installer is available, run the bootstrap fallback:
   ```sh
   curl -fsSL https://volcano.dev/bootstrap.sh -o /tmp/volcano-bootstrap.sh && sh /tmp/volcano-bootstrap.sh --apply
   ```
   Re-run `which volcano` to confirm. If already installed, run `volcano upgrade`
   to ensure the latest version — it only downloads if a newer release exists.

2. **Check skills**: if you are running from a Volcano IDE/plugin installation,
   use the plugin-shipped `volcano-*` skills. Otherwise verify
   `~/.volcano/skills/volcano-platform/SKILL.md` and
   `~/.volcano/skills/volcano-sdk/SKILL.md` exist; if missing, re-run the
   bootstrap fallback above.

## CLI-first

**For any Volcano-related action, check whether the CLI has a supporting command before
falling back to manual file edits or API calls.** Use `volcano <area> --help` to discover
flags before guessing.

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
  https://volcano.dev/device?user_code=XXXX-XXXX
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
request to create or update the project files. After building, run only
non-deploying validation when available, such as typecheck, lint, unit tests, or
`npm run build:functions`. Do **not** start services, deploy functions, deploy
variables/config, run migrations, or invoke functions unless the user asks to
run, test, preview, deploy, verify end-to-end, or otherwise exercise the app.

At the end of a build-only task, suggest concrete next actions instead of taking
them automatically. For example: "Next, I can locally deploy and test this by
running `volcano start`, `volcano variables deploy`, `volcano functions deploy
--all`, `volcano config deploy`, `volcano migrations deploy --all -d app`, then
invoke the todo functions through the local API." Keep suggestions specific to
what was built and clearly separate them from work already completed.

During development, use **local mode** by default. Local mode means Volcano CLI
commands **without** the `cloud` prefix, such as `volcano functions list`,
`volcano variables deploy`, and `volcano functions deploy --all`. Cloud mode is
only the corresponding `volcano cloud ...` command surface.

When the user does ask to run/test/preview locally, stay in local mode rather than
cloud mode: `volcano start`, then deploy the required local resources (`volcano
variables deploy`, `volcano functions deploy --all`, `volcano config deploy`,
`volcano migrations deploy --all -d app`) and test via the local API at
`http://localhost:8000`.

**Cloud deploy** (only when the user explicitly requests cloud deployment): verify
(1) CLI is authenticated (`volcano status`), (2) a project exists and is selected
(`volcano projects list`, then `volcano use <id-or-name>`). **Cloud deploys
require explicit user confirmation.**

## Safety model

**Automatic when relevant to the user's requested scope (no confirmation needed):**
- Inspect: `volcano status`, `volcano projects list`, `volcano projects get <id>`
- Scaffold: `volcano init`
- List/get: `volcano functions list|get`, `volcano variables list|get`, `volcano databases list|get`, `volcano storage bucket list|get`
- Logs: `volcano functions logs <name> --type build|runtime`
- Local dev: `volcano start|stop|restart|status` when the user asks to run/test/preview locally
- Local deploy: `volcano functions deploy`, `volcano variables deploy`, `volcano config deploy`, `volcano migrations deploy --all -d app` when the user asks to run/test/preview locally

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
