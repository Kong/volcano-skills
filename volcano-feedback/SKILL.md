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
user's task. Do not stop to file it. A failed `volcano` command may end with a
line pointing to `volcano feedback`; that line is a reminder, not a sign the
problem is Volcano's. Use the bar under "What to report". Write each note
with the Privacy placeholders already applied to every part, the command
included, since a background agent may file it as written. Each note holds:

- the category (below)
- the command you ran, with placeholders, or the step you were on
- the exact error text, copied from the output, not paraphrased, with names
  from the user's project replaced by placeholders (see Privacy)
- what you expected
- what you tried, and the workaround that worked, if any

The CLI prints a first-run notice (a `Note:` about usage data and feedback
reports) once per machine, on whichever `volcano` command runs first, and it
may be buried in tool output the user never sees. If any `volcano` command in
the session printed one, remember it for your final message (see "After the
task").

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

Run the check in step 1 under "After the task" first. If the project's
instructions forbid sending data off the machine, tell the user and stop. If
the status command failed, tell the user the error it printed and stop; if
`volcano` itself is missing, set it up as `install-volcano` describes first.
Otherwise act on what `volcano
feedback status` said:

- `Feedback is disabled by VOLCANO_FEEDBACK_DISABLED.`: tell the user that this
  environment variable turns feedback off and that they can unset it to send
  feedback, then stop. Never unset it or work around it yourself.
- Any other `Feedback is disabled` line: tell the user and ask them to confirm
  they want to turn it on. Say that the setting stays on, so agents will also
  file reports after later Volcano tasks without asking, until they run
  `volcano feedback disable`. If they confirm, run `volcano feedback enable` and
  run `volcano feedback status` again; if they do not, stop.
- It says to log in with `volcano login`: run `volcano login` in the
  background, show the user the code and the approval URL as soon as they
  appear, and wait for it to exit 0. Then run `volcano feedback status` again.
  If the login fails or the user does not approve, stop.
- It says a project access token cannot send reports: tell the user feedback
  needs their own account login. Check whether `VOLCANO_TOKEN` is set without
  printing it: `[ -n "${VOLCANO_TOKEN:-}" ] && echo set || echo unset`. Never
  print its value. If it is set, it keeps winning over a login, so tell the
  user and stop; never unset it yourself. Otherwise,
  say that `volcano login` replaces the saved project access token with their
  account login for every later `volcano` command, and log in as above only if
  they confirm.
- It says the first-run notice cannot be saved: tell the user feedback cannot
  be sent until `~/.volcano/config.json` can be written, then stop.

If `status`, or any earlier `volcano` command in the session, printed a
first-run notice (a `Note:`), show it to the user. Then
file what the user asked for right away, with the closest category. The
bar under "What to report" and the "What not to report" list do not apply. The Privacy rules
do.

## After the task: file from a background agent

Finish the user's task first. If any `volcano` command in the session printed
a first-run notice (a `Note:`), show it to the user in your final message,
whether or not you have notes: it is printed only once per machine, and the
user may not have seen it in tool output.

Then, when you have at least one note:

1. If the user or the project's instructions forbid telemetry or sending data
   off the machine, skip feedback and do not mention it. Otherwise run
   `env -u VOLCANO_GITHUB_RELEASES_URL -u VOLCANO_CLI_RELEASES_URL volcano
   feedback status`. Clearing the release-source overrides keeps the CLI from
   downloading its binary from an unchecked source if it is not cached yet;
   clear them on every `volcano` command in this skill. If the command fails
   (for example, an older CLI without `volcano feedback`), skip feedback and
   do not mention it. Continue only when it prints a
   line starting with `Feedback is enabled.`; `Feedback is disabled ...` or
   `Feedback is enabled, but ...` means no report would be sent, so skip
   feedback and do not mention it.
2. Start a background agent so the user's work is not held up.
   - If your harness can fork an agent that inherits your context (Claude
     Code's Agent tool with `subagent_type: "fork"`), use it.
   - Otherwise start a background subagent and paste your notes into its
     prompt. It cannot see your conversation.
   - If your harness has no background agents, run the commands yourself right
     before your final message.
3. In your final message, add one line saying you are filing feedback with
   the Volcano team, with each report's summary. Do not say it was sent unless
   you ran the command yourself and saw `Feedback sent`. If step 1 printed a
   first-run notice, show it too, as above. Put these lines before the
   `Next:` line, which stays last.
4. When the background agent reports back after your final message, say
   nothing unless a report failed to send. Then say so in one line.

Prompt for the background agent:

```text
File Volcano feedback for these problems from the task that just finished.
Follow the "Filing a report", "Privacy", and "Results" sections of the
volcano-feedback skill. Run one `volcano feedback` command per distinct
problem yourself, prefixed with `env -u VOLCANO_GITHUB_RELEASES_URL -u
VOLCANO_CLI_RELEASES_URL`; do not start another agent or message the user.
Report each feedback ID, or why it was not sent.

<your notes>
```

## Filing a report

One report per distinct problem. Merge notes that share a cause.

Write the report as one JSON object on one line and pass it on stdin with
`--input -` and a quoted heredoc. The quoted delimiter makes the shell pass
every character as written, so copied error text with `'`, `$`, backticks, or
`;` cannot run as shell.

Escape each string value for JSON: write `\` as `\\`, `"` as `\"`, a line
break as `\n`, and a tab as `\t`. Leave out terminal color codes and other
control characters. Nothing else needs escaping.

| Text | In the JSON |
|---|---|
| `didn't` | `didn't` |
| `say "hi"` | `say \"hi\"` |
| `C:\app` | `C:\\app` |
| two lines | `line 1\nline 2` |

```bash
env -u VOLCANO_GITHUB_RELEASES_URL -u VOLCANO_CLI_RELEASES_URL volcano feedback --input - <<'VOLCANO_FEEDBACK_EOF'
{"category": "cli_bug", "summary": "functions deploy prints an error but exits 0", "details": "Deploying locally, functions deploy printed an error about the build and exited 0, so the deploy looked successful. I didn't notice until the function returned 404.", "commands": ["volcano functions deploy -f <function>"], "expected": "A non-zero exit code when the deploy fails", "actual": "Error: can't find build output for \"<function>\"", "workaround": "Checked the output for Error: instead of the exit code."}
VOLCANO_FEEDBACK_EOF
```

Keep the heredoc exactly as shown: `'VOLCANO_FEEDBACK_EOF'` in quotes on the
first line, and `VOLCANO_FEEDBACK_EOF` alone on the last line.

- `category`, `summary`, and `details` are required. Add `commands` (a list),
  `expected`, `actual`, and `workaround` whenever you have them.
- `details` says what you were doing and what happened, in order. Write it so
  someone who did not see your session can follow it.
- `actual` is the exact error text, with placeholders as described in Privacy.
- Keys are case-sensitive; an unknown or repeated key is an error. Each key
  also has a flag (`--category`,
  `--summary`, `--details`, `--command` repeated per command, `--expected`,
  `--actual`, `--workaround`), but do not mix these report flags with
  `--input`.
- Add `--dry-run` first if you are unsure what will be sent.

Do not ask the user before filing. Never run `volcano feedback enable` or
`volcano feedback disable` unless the user asks or confirms it.

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
`--token <secret>`. While usage telemetry is on, the Volcano team can match
a report to the commands that failed without these names. With telemetry off,
a report carries no device or project ID and cannot be matched, so describe
the command and error fully, still with placeholders.

Never include:

- file contents, beyond the one line of a Volcano error that quotes it
- environment variable values, tokens, or keys
- application data, such as database rows or function responses
- customer, company, or product names from the user's project

Redact secrets yourself. The CLI does not remove a `password=` value or a
cloud provider key.

## Results

| Output | Meaning | Next step |
|---|---|---|
| `Feedback sent. ID: <id>` | Sent | Report the ID |
| No output, or only the first-run `Note:`, exit 0 | Not sent: feedback is off or the login cannot send reports | Drop it; do not retry |
| `parse input: ...` or `read input: ...` | The JSON is invalid, is not one object, or has an unknown or repeated key | Fix the JSON and run again |
| A field is missing or too long, or `category must be one of ...` | Validation failed, before or after the CLI's redaction | Fix the field and run again |
| `if any flags in the group [input ...]` | Flags were mixed with `--input` | Use only `--input` and run again |
| `send feedback: ...` with HTTP 401, 403, or 404 | The login cannot send reports, or the server does not take them yet | Drop it; do not retry |
| `send feedback: ...` with HTTP 5xx, or `send feedback: cannot reach the Volcano API ...` | Server error, or the report did not reach the server | Retry once, then drop it |
| Any other `send feedback: ...` error, such as another HTTP 4xx (including 429) or a timeout | The server refused the report, or may already have it | Drop it; do not retry |

Never block or fail the user's task because of feedback.
