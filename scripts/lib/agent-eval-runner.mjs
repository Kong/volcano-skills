/**
 * Shared scenario-execution logic for the agent-behavior eval harness.
 *
 * Kept independent of any specific model provider so it can be exercised by
 * a deterministic self-test (fixture responses, no network/API key) and by
 * the live runner (real model calls) with identical evaluation logic.
 */

export function buildSystemPrompt(agentsMdText) {
  return [
    "You are an AI coding agent operating in a user's terminal/IDE, with a shell",
    "and the `volcano` CLI already installed. Follow the instructions below",
    "exactly.",
    "",
    "You have no tools available in this session and cannot actually run",
    "anything. This is expected and is not a problem to solve or mention. Do",
    "NOT explore the filesystem, do NOT propose commands for the user to approve,",
    "do NOT ask clarifying questions, and do NOT ask what's in the current",
    "directory — you already have every detail you need in the user's message.",
    "Any tool output shown there (e.g. `volcano status`) has already been",
    "observed by you. When the instructions below say to take an action",
    "automatically, treat it as already done successfully and write the single,",
    "complete, final response you would give the end user after having done it —",
    "the same response you'd give if you did have tools and had just finished. Do",
    "NOT defer any of those automatic actions with phrasing like 'once you",
    "confirm', 'once you approve', or 'I'll do X after you say go' — the",
    "instructions below already grant you standing permission for anything they",
    "mark automatic; only the actions they explicitly mark confirm-first still",
    "need to be phrased as a pending request. Respond with that final answer",
    "only, in one turn. Do not include",
    "meta-commentary about being an AI, about lacking tools, or about this being",
    "a test.",
    "",
    "=== AGENTS.md ===",
    agentsMdText,
  ].join("\n");
}

/**
 * Run every (non-judge) deterministic assertion in a scenario against a
 * response, plus every judge assertion via the provided judge function.
 *
 * @returns {{ id: string, rule: string, results: Array<{label, pass, message, detail, isJudge, blocking}>, blockingFailures: number }}
 */
export async function evaluateScenario(scenario, responseText, { judgeFn } = {}) {
  const results = [];

  for (const assertion of scenario.assertions) {
    if (assertion.isJudge) {
      if (!judgeFn) {
        results.push({
          label: assertion.label,
          pass: null,
          message: "skipped (no judge function configured)",
          isJudge: true,
          blocking: assertion.blocking,
        });
        continue;
      }
      const verdict = await judgeFn(assertion.question, responseText);
      results.push({
        label: assertion.label,
        pass: verdict.pass,
        message: verdict.reason ?? "",
        isJudge: true,
        blocking: assertion.blocking,
      });
      continue;
    }

    const { pass, message, detail } = assertion.check(responseText);
    results.push({ label: assertion.label, pass, message, detail, isJudge: false, blocking: true });
  }

  const blockingFailures = results.filter((r) => r.blocking && r.pass === false).length;

  return { id: scenario.id, rule: scenario.rule, results, blockingFailures };
}

export function formatReport(scenarioResults) {
  const lines = [];
  let totalBlockingFailures = 0;

  for (const sr of scenarioResults) {
    totalBlockingFailures += sr.blockingFailures;
    const status = sr.blockingFailures === 0 ? "PASS" : "FAIL";
    lines.push(`\n[${status}] ${sr.id} — ${sr.rule}`);
    for (const r of sr.results) {
      const marker = r.pass === null ? "SKIP" : r.pass ? "ok  " : "FAIL";
      const advisory = r.isJudge && !r.blocking ? " (advisory)" : "";
      lines.push(`  ${marker} ${r.label}${advisory}${r.message ? ` — ${r.message}` : ""}`);
      if (r.pass === false && r.detail) {
        lines.push(`       text: ${JSON.stringify(r.detail)}`);
      }
    }
  }

  lines.push(
    `\n${scenarioResults.length} scenario(s), ${totalBlockingFailures} blocking failure(s) across ${scenarioResults.reduce((n, sr) => n + sr.results.length, 0)} assertion(s).`,
  );

  return { text: lines.join("\n"), totalBlockingFailures };
}
