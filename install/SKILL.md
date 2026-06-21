---
name: install
description: Install or refresh the Volcano CLI, canonical agent instructions, and Volcano skills.
argument-hint: "[--local]"
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Install / refresh Volcano CLI and canonical skills

Use this skill when the user asks to install, refresh, or set up Volcano.

## Pick the agent flag

When this skill is loaded through a native plugin, use the matching agent flag:

- Codex: `--agent codex`
- Cursor: `--agent cursor`
- Claude Code / Claude Desktop: `--agent claude`

If you are unsure, omit `--agent`; bootstrap will install the canonical CLI/docs/skills and auto-detect known agent config directories when possible.

## Production install

For Codex, run:

```sh
curl -fsSL "https://volcano.dev/bootstrap.sh" -o /tmp/volcano-bootstrap.sh && sh /tmp/volcano-bootstrap.sh --apply --agent codex
```

For Cursor, run:

```sh
curl -fsSL "https://volcano.dev/bootstrap.sh" -o /tmp/volcano-bootstrap.sh && sh /tmp/volcano-bootstrap.sh --apply --agent cursor
```

For Claude Code / Claude Desktop, run:

```sh
curl -fsSL "https://volcano.dev/bootstrap.sh" -o /tmp/volcano-bootstrap.sh && sh /tmp/volcano-bootstrap.sh --apply --agent claude
```

## Local Volcano web development

If the user passes `--local` or explicitly says they are developing Volcano locally, use the local web origin and the appropriate agent flag. For example, Codex local development:

```sh
export VOLCANO_WEB_URL=http://localhost:3000 && curl -fsSL "http://localhost:3000/bootstrap.sh" -o /tmp/volcano-bootstrap.sh && sh /tmp/volcano-bootstrap.sh --apply --agent codex
```

## Verify

After bootstrap completes:

1. Run `which volcano` and confirm it succeeds.
2. Read `~/.volcano/AGENTS.md` before taking Volcano actions.
3. Use the canonical skills in `~/.volcano/skills/` for subsequent Volcano work.
4. Prefer the `volcano` CLI for Volcano actions. Use `volcano <area> --help` and `--json` where useful.

## Safety

Follow the safety model in `~/.volcano/AGENTS.md`. In particular, production deploys, deletions, secret/variable changes, permission/visibility changes, custom domains, and billing/account changes require explicit user confirmation.
