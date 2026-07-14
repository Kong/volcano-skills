/**
 * Model-call abstraction for the agent-behavior eval harness. Two providers:
 *
 * - claude-cli: shells out to the locally installed, already-authenticated
 *   `claude` CLI (--print, --tools "" to fully disable tool execution, a
 *   scratch cwd to avoid picking up this repo's own AGENTS.md/CLAUDE.md).
 *   This is the default local path — no API key or secret needed, since it
 *   reuses whatever Claude Code session you're already logged into.
 * - openai: calls the OpenAI chat completions API directly. Used by the
 *   gated CI workflow (agent-eval.yml), where there's no interactive CLI
 *   session to reuse.
 *
 * Both are kept as single small functions so the runner can be unit-tested
 * by injecting a fake provider (see eval-agent-guidance-selftest.mjs)
 * without any network access, API key, or the `claude` CLI installed.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_OPENAI_MODEL = process.env.AGENT_EVAL_MODEL || "gpt-4o-mini";
const DEFAULT_CLAUDE_CLI_MODEL = process.env.AGENT_EVAL_MODEL || "sonnet";
// A full AGENTS.md as system prompt is large; observed real scenario calls
// taking up to ~160s with the `sonnet` model. Give real headroom by default.
const CLAUDE_CLI_TIMEOUT_MS = Number(process.env.AGENT_EVAL_CLAUDE_CLI_TIMEOUT_MS || 240_000);
// Bound each OpenAI request so a stalled connection can't hang the sequential
// scenario run (and the CI job) indefinitely, mirroring the claude-cli timeout.
const OPENAI_TIMEOUT_MS = Number(process.env.AGENT_EVAL_OPENAI_TIMEOUT_MS || 120_000);

/**
 * Call an OpenAI-compatible chat completions endpoint.
 * @param {{system: string, user: string}} messages
 * @returns {Promise<string>} the assistant's response text
 */
export async function callOpenAI({ system, user }, { model = DEFAULT_OPENAI_MODEL, apiKey } = {}) {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set; cannot make a live model call");
  }

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === "TimeoutError") {
      throw new Error(`OpenAI request timed out after ${OPENAI_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error(`Unexpected OpenAI response shape: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return text;
}

/**
 * Call the local `claude` CLI in non-interactive, tool-free mode.
 *
 * - `--system-prompt` fully replaces the default system prompt (verified: it
 *   does not leak the user's global ~/.claude/CLAUDE.md content).
 * - `--tools ""` disables all tool execution — verified the model cannot
 *   run shell commands or edit files even when a scenario prompt tries to
 *   induce it to (see tests/agent-eval/README.md).
 * - runs from a scratch temp directory so this repo's own AGENTS.md/
 *   CLAUDE.md is never auto-discovered and mixed into the eval.
 * - `--no-session-persistence` avoids leaving eval sessions in `claude
 *   --resume` history.
 *
 * @param {{system: string, user: string}} messages
 * @returns {Promise<string>} the assistant's response text
 */
export async function callClaudeCli({ system, user }, { model = DEFAULT_CLAUDE_CLI_MODEL } = {}) {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "volcano-agent-eval-"));
  try {
    const { stdout } = await execFileAsync(
      "claude",
      [
        "--print",
        "--model",
        model,
        "--system-prompt",
        system,
        "--tools",
        "",
        "--no-session-persistence",
        "--output-format",
        "text",
        user,
      ],
      { cwd: scratchDir, timeout: CLAUDE_CLI_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim();
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

/** True when the local `claude` CLI is on PATH. */
export async function hasClaudeCliAvailable() {
  try {
    await execFileAsync("claude", ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve which provider to use. Explicit AGENT_EVAL_PROVIDER wins; else
 * prefer OPENAI_API_KEY (matches the CI workflow) when set; else fall back
 * to the local `claude` CLI, which needs no key/secret at all.
 */
export async function resolveProvider(env = process.env) {
  const explicit = env.AGENT_EVAL_PROVIDER;
  if (explicit === "openai") return "openai";
  if (explicit === "claude-cli") return "claude-cli";
  if (explicit) throw new Error(`Unknown AGENT_EVAL_PROVIDER: ${explicit}`);

  if (env.OPENAI_API_KEY) return "openai";
  if (await hasClaudeCliAvailable()) return "claude-cli";
  return null;
}

/** Call whichever provider `resolveProvider` selects. */
export async function callProvider(messages, { provider, model } = {}) {
  const resolved = provider ?? (await resolveProvider());
  if (resolved === "openai") return callOpenAI(messages, { model });
  if (resolved === "claude-cli") return callClaudeCli(messages, { model });
  throw new Error(
    "No model provider available: set OPENAI_API_KEY, or install/authenticate the `claude` CLI, " +
      "or set AGENT_EVAL_PROVIDER explicitly.",
  );
}

/** True when a live provider call is configured (used to gate CI steps). */
export function hasLiveProviderConfigured(env = process.env) {
  return Boolean(env.OPENAI_API_KEY);
}
