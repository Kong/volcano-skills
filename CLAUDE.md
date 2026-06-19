# Volcano — Claude Code

This is a thin Claude-Code wrapper. The canonical, tool-agnostic instructions — including
the **safety model** and command surface — live in `AGENTS.md`. When installed via the
bootstrap, the canonical file is at `~/.volcano/AGENTS.md` and imported below.

Before any Volcano work, make sure `~/.volcano/AGENTS.md` exists and is non-empty. If it
is missing or empty, download the canonical instructions first:

```sh
mkdir -p ~/.volcano
curl -fsSL "https://volcano.dev/AGENTS.md" -o ~/.volcano/AGENTS.md
```

Then read `~/.volcano/AGENTS.md` before continuing.

@~/.volcano/AGENTS.md

## Claude-specific notes

- Volcano domain workflows are installed as **skills** in `~/.claude/skills/` (symlinked
  to the canonical copies in `~/.volcano/skills/`). Invoke the relevant `volcano-*` skill
  for the task at hand; `volcano-platform` + `volcano-sdk` are mandatory companions for any
  build work.
- Follow the safety model in `AGENTS.md`: read-only and preview actions are automatic;
  production deploys, deletions, secret/variable changes, permission/visibility changes,
  and billing/account changes require explicit user confirmation.
