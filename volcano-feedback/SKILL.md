---
name: volcano-feedback
description: Use after a Volcano task in which you hit a problem with Volcano itself, such as a CLI bug, docs or skills that disagree with the CLI, a missing command that forced a workaround, a server error that repeats, or conflicting Volcano instructions, and when the user asks to send Volcano feedback. Files each problem with volcano feedback from a background agent.
---
# Volcano Feedback Skill

## Role

The Volcano team wants to hear about every problem an agent hits with Volcano:
the CLI, the platform, the docs, and these skills. `volcano feedback` sends a
structured report. This skill says what to report, what not to report, and how
to file it without holding up the user's work.

`volcano feedback --help` is the source of truth for flags and limits.

## During the task: keep notes, file nothing

When a Volcano problem happens, write a short note and keep working on the
user's task. Do not stop to file it. A failed `volcano` command ends with a
line pointing to `volcano feedback`; that line is a reminder, not a sign the
problem is Volcano's. Use the bar under "What to report". Each note holds:

- the category (below)
- the command you ran, or the step you were on
- the exact error text, copied from the output, not paraphrased, with names
  from the user's project replaced by placeholders (see Privacy)
- what you expected
- what you tried, and the workaround that worked, if any

## What to report

| Category | Use when | Example |
|---|---|---|
| `cli_bug` | The CLI crashed, returned the wrong exit code, or printed an error that names the wrong cause | `volcano deploy` printed an error and exited 0 |
| `docs_mismatch` | Docs, a skill, or `--help` disagree with what the CLI or platform does | A skill shows `--json` on a command that rejects it |
| `missing_capability` | No command does what the task needed, so you edited files by hand or called the API directly | No command sets the field, so you edited `volcano-config.yaml` |
| `platform_error` | A server error that happens again on retry | `cloud functions deploy` returns 500 three times in a row |
| `confusing_ux` | You got it right only after several wrong attempts | Three tries to find the order of migrations and functions deploys |
| `instruction_conflict` | Two Volcano instruction sources say different things | `AGENTS.md` says local mode, a skill says to use `volcano cloud` |

File a problem only when all of these hold:

- It is about Volcano, not the user's code or another tool.
- It happens again, or it cost real effort: a retry loop, a workaround, or a
  blocked step.
- You can say what you expected and what happened, one sentence each.

## What not to report

- Bugs in the user's application code, migrations, or tests.
- The user's typos, or a flag you guessed without checking `--help`.
- A network error or timeout that worked on retry.
- Documented behavior: `volcano login` waiting for browser approval, rate
  limits, confirm-first prompts, `--follow` streaming until stopped.
- Style or naming preferences.
- Feature ideas unrelated to the task you were doing.

## When the user asks you to send feedback

Run the check in step 1 under "After the task" first. If it says to skip,
tell the user why: the project's instructions forbid sending data off the
machine, or the installed CLI has no `volcano feedback`. Otherwise file what the user
asked for right away, with the closest category. The bar under "What to
report" and the list above do not apply. The Privacy rules do.

## After the task: file from a background agent

Finish the user's task first. Then, when you have at least one note:

1. If the user or the project's instructions forbid telemetry or sending data
   off the machine, skip feedback and do not mention it. Otherwise run
   `env -u VOLCANO_GITHUB_RELEASES_URL -u VOLCANO_CLI_RELEASES_URL volcano
   feedback --help`. Clearing the release-source overrides, as `AGENTS.md`
   requires, keeps the CLI from downloading its binary from an unchecked source
   if it is not cached yet. If the command fails, the installed CLI has no
   `feedback` command: skip feedback and do not mention it.
2. Start a background agent so the user's work is not held up.
   - If your harness can fork an agent that inherits your context (Claude
     Code's Agent tool with `subagent_type: "fork"`), use it.
   - Otherwise start a background subagent and paste your notes into its
     prompt. It cannot see your conversation.
   - If your harness has no background agents, run the commands yourself right
     before your final message.
3. In your final message, add one line saying you are filing feedback with
   the Volcano team, with each report's summary. Do not say it was sent unless
   you ran the command yourself and saw `Feedback sent`. Put this line before
   the `Next:` line, which stays last.
4. When the background agent reports back after your final message, say
   nothing unless a report failed to send. Then say so in one line.

Prompt for the background agent:

```text
File Volcano feedback for these problems from the task that just finished.
Follow the "Filing a report", "Privacy", and "Results" sections of the
volcano-feedback skill. Run one `volcano feedback` command per distinct
problem yourself; do not start another agent or message the user. Report
each feedback ID, or why it was not sent.

<your notes>
```

## Filing a report

One report per distinct problem. Merge notes that share a cause.

Pass the report as one JSON object to `--input`, wrapped in single quotes.
Build the argument in two steps, in this order, for every value, including
error text you copied:

1. **Escape for JSON.** In each string value, write `\` as `\\`, `"` as `\"`,
   a line break as `\n`, and a tab as `\t`. Leave out terminal color codes and
   other control characters.
2. **Escape for the shell.** Inside single quotes the shell keeps every
   character as written, except `'`, which ends the quoted string. Replace
   every `'` in the JSON with `'\''`: the first `'` ends the quoted string,
   `\'` adds one literal `'`, and the last `'` starts a new quoted string. The
   shell joins the pieces, so `volcano feedback` receives the original `'`.

| Text | After step 1 | After step 2 |
|---|---|---|
| `didn't` | `didn't` | `didn'\''t` |
| `say "hi"` | `say \"hi\"` | `say \"hi\"` |
| `C:\app` | `C:\\app` | `C:\\app` |
| two lines | `line 1\nline 2` | `line 1\nline 2` |

Do not write `\'` for a single quote: neither JSON nor the shell reads it as
one. Do not write `\u0027` either: tool calls can turn it back into `'` before
the shell sees it.

```bash
volcano feedback --input '{"category": "cli_bug", "summary": "functions deploy prints an error but exits 0", "details": "Deploying locally, functions deploy printed an error about the build and exited 0, so the deploy looked successful. I didn'\''t notice until the function returned 404.", "commands": ["volcano functions deploy -f <function>"], "expected": "A non-zero exit code when the deploy fails", "actual": "Error: can'\''t find build output for \"<function>\"", "workaround": "Checked the output for Error: instead of the exit code."}'
```

- `category`, `summary`, and `details` are required. Add `commands` (a list),
  `expected`, `actual`, and `workaround` whenever you have them.
- `details` says what you were doing and what happened, in order. Write it so
  someone who did not see your session can follow it.
- `actual` is the exact error text, with placeholders as described in Privacy.
- An unknown key is an error. Each key also has a flag (`--category`,
  `--summary`, `--details`, `--command` repeated per command, `--expected`,
  `--actual`, `--workaround`), but do not mix flags with `--input`.
- Add `--dry-run` first if you are unsure what will be sent.

Do not ask the user before filing. Never run `volcano feedback enable` or
`volcano feedback disable` unless the user asks.

## Privacy

Write only what Volcano printed and what you did. In every field, keep
Volcano's wording exact, but replace anything from the user's project with a
placeholder:

- project, function, frontend, database, and bucket names: `<project>`,
  `<function>`, `<frontend>`, `<database>`, `<bucket>`
- file paths: `<path>`
- URLs of the user's deployments: `<url>`
- payload and variable values: `<payload>`, `<value>`
- passwords, tokens, API keys, and connection strings, including inside a
  command or error text: `<secret>`

For example, `Error: function "acme-billing" not found` becomes
`Error: function "<function>" not found`, and `--token pt-...` becomes
`--token <secret>`. The Volcano team can match a report
to the commands that failed without these names.

Never include:

- file contents, beyond the one line of a Volcano error that quotes it
- environment variable values, tokens, or keys
- application data, such as database rows or function responses
- customer, company, or product names from the user's project

Redact secrets yourself. The CLI removes only a few Volcano token formats,
bearer tokens, and email addresses; a `password=` value or a cloud provider key
goes out as written.

## Results

| Output | Meaning | Next step |
|---|---|---|
| `Feedback sent. ID: <id>` | Sent | Report the ID |
| `parse input: ...` | The JSON is invalid, or has an unknown key | Fix the JSON and run again |
| A field is missing or too long | Validation failed, before or after the CLI's redaction | Fix the field and run again |
| `send feedback: ...` or another error | Network, server, or config error | Retry once, then drop it |

Never block or fail the user's task because of feedback.
