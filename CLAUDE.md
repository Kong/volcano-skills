# Volcano — Claude Code

This is a thin Claude-Code wrapper. The canonical, tool-agnostic instructions — including
the **safety model** and command surface — live in `AGENTS.md`.

## Instruction source

- When installed through a Volcano Claude Code plugin, use the plugin-shipped sibling
  `AGENTS.md` and `volcano-*` skills from the plugin's `skills/` directory.
- When installed through the bootstrap/runtime path, the canonical file is at
  `~/.volcano/AGENTS.md`; read it before continuing.
- If neither source is available, fetch the canonical instructions as a fallback:

```sh
mkdir -p ~/.volcano
curl -fsSL "https://volcano.dev/AGENTS.md" -o ~/.volcano/AGENTS.md
```

Then read `AGENTS.md` from the active plugin or `~/.volcano/AGENTS.md` before continuing.

## Claude-specific notes

- Volcano domain workflows are installed as **skills** in the active plugin or in
  `~/.claude/skills/` for bootstrap installs. Invoke the relevant `volcano-*` skill
  for the task at hand; `volcano-platform` + `volcano-sdk` are mandatory companions for any
  build work.
- Follow the safety model in `AGENTS.md`: read-only and preview actions are automatic;
  production deploys, deletions, secret/variable changes, permission/visibility changes,
  and billing/account changes require explicit user confirmation.
