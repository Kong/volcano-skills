---
name: install-volcano
description: Install, upgrade, or set up the Volcano CLI. Use this whenever a task needs the volcano CLI and `which volcano` hasn't been confirmed yet, even if the user never says "install" (e.g. "build me a todo API using volcano").
allowed-tools: Bash, WebFetch, Read
---

# Install or upgrade the Volcano CLI

Use this skill proactively, without waiting to be asked, whenever Volcano work is
starting and the CLI's presence/version hasn't been checked yet — not just when
the user explicitly says "install". It runs well-known commands directly — there
is no bespoke installer script to read or reconstruct.

(The `volcano-sdk` and `volcano-platform` skills carry this same check as their
first step, so a normal build flow already ensures the CLI without invoking
this skill. This skill is the explicit, on-demand version of that flow.)

## What to do

1. Run `which volcano`.
2. **If found:** run `volcano upgrade` to keep it on the latest version. It's a
   harmless, best-effort refresh and a no-op when already current. Treat any
   failure (transient network/GitHub issue) as a no-op and continue — the
   installed CLI still works; a failed upgrade is not a blocker.
3. **If missing:** fetch
   `https://raw.githubusercontent.com/Kong/volcano-cli/main/docs/installation.md`
   (plain Markdown, readable without the CLI — via your fetch tool or `curl`)
   and run whichever install method it documents that matches a package
   manager already on `PATH`. Check `which npm`, `which pnpm`, `which bun`,
   `which brew` in that order, and only use the documented manual `curl`
   install if none are present. Run the one matching command exactly as
   documented. A fresh install is already the latest version.
4. Re-run `which volcano` to confirm it resolves, and report the result.

Do not assume a package manager that isn't installed, and do not invent steps
beyond what the installation doc lists. If `volcano` still isn't on `PATH`
after a successful install, its install directory may need to be added to
`PATH` — open a new shell or follow the installer's own printed instructions.

## After install

1. Use the plugin-shipped Volcano skills for subsequent Volcano work.
2. Prefer the `volcano` CLI for Volcano actions. Use `volcano <area> --help`
   for flags and `volcano docs search "<topic>"` for concepts/errors.

## Safety

Follow the safety model in the plugin-shipped `AGENTS.md`. Production deploys, deletions, secret/variable changes, permission/visibility changes, custom domains, and billing/account changes require explicit user confirmation.
