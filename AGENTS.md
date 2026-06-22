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

Always run `volcano init` **first**, before writing any code. Templates: `volcano init`
(JavaScript, default), `volcano init nextjs`, `volcano init python`, `volcano init ruby`.
Add `--example notes` (or `--example hello-world`) for a demo. After init, use the
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

### Deploying

**Default to local.** Unless the user explicitly asks for a cloud deploy, test locally
first: `volcano start`, then `volcano functions deploy --all`, `volcano variables deploy`,
`volcano migrations deploy --all -d app`. Test at `http://localhost:8000`.

**Cloud deploy** (when the user explicitly requests it): verify (1) CLI is authenticated
(`volcano status`), (2) a project exists and is selected (`volcano projects --json`,
then `volcano use <id>`). **Cloud deploys require explicit user confirmation.**

## Safety model

**Automatic (no confirmation needed):**
- Inspect: `volcano status`, `volcano projects`, `volcano projects get <id>`
- Scaffold: `volcano init`
- List/get: `volcano functions list|get`, `volcano variables list`, `volcano databases list|get`, `volcano storage buckets list|get`
- Logs: `volcano functions logs <name> --type build|runtime`
- Local dev: `volcano start|stop|restart|status`
- Local deploy: `volcano functions deploy`, `volcano variables deploy`, `volcano config deploy`, `volcano migrations deploy --all -d app`

**Confirm-first:**
- Cloud deploys: `volcano cloud functions deploy`, `volcano cloud frontends deploy`, `volcano cloud config deploy`, `volcano cloud variables deploy`
- Deletions: any `... delete` (local or cloud)
- Secret / variable changes: `volcano cloud variables deploy`
- Permission / visibility changes: `volcano cloud functions update --public|--private`, storage policies, custom domains
- Billing / account changes: plan changes, account promotion

When in doubt, treat the action as confirm-first.

## Machine-readable usage

Use `--json` for structured output, `--non-interactive` to fail fast, `--yes` to
auto-confirm after user approval. Check exit codes; non-zero means failure.

## Command surface

```bash
# Auth & project
volcano login | logout | projects | projects get <id> | use <id-or-name>

# Scaffold
volcano init [nextjs|python|ruby]

# Local development (targets local dev server)
volcano start|stop|restart|status
volcano functions deploy --all | deploy -f <name> | list | get | logs
volcano variables deploy | list | get
volcano config deploy
volcano databases list|get
volcano storage buckets list|get
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
