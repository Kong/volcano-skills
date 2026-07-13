#!/usr/bin/env node
/**
 * Agent-behavior eval harness.
 *
 * Feeds the canonical AGENTS.md (this repo's root) plus each
 * scenario prompt in tests/agent-eval/scenarios.mjs into a real model call,
 * then checks the response against deterministic (and optional advisory
 * judge) assertions. See tests/agent-eval/README.md.
 *
 * Modes:
 *   --lint   validate scenario structure only; no model calls, no API key.
 *   (none)   live run. Defaults to the local `claude` CLI (no API key
 *            needed) if it's installed/authenticated, else OPENAI_API_KEY.
 *            Override with AGENT_EVAL_PROVIDER=claude-cli|openai.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scenarios } from "../tests/agent-eval/scenarios.mjs";
import { buildSystemPrompt, evaluateScenario, formatReport } from "./lib/agent-eval-runner.mjs";
import { callProvider, resolveProvider } from "./lib/agent-eval-provider.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_MD_PATH = path.join(root, "AGENTS.md");

function lintScenarios() {
  const errors = [];
  const seenIds = new Set();

  for (const [i, scenario] of scenarios.entries()) {
    const where = `scenarios[${i}]`;
    if (!scenario.id || typeof scenario.id !== "string") {
      errors.push(`${where}: missing/invalid id`);
    } else if (seenIds.has(scenario.id)) {
      errors.push(`${where}: duplicate id "${scenario.id}"`);
    } else {
      seenIds.add(scenario.id);
    }
    if (!scenario.rule || typeof scenario.rule !== "string") {
      errors.push(`${scenario.id ?? where}: missing "rule" (must cite the AGENTS.md rule being checked)`);
    }
    if (!scenario.prompt || typeof scenario.prompt !== "string" || scenario.prompt.trim() === "") {
      errors.push(`${scenario.id ?? where}: missing/empty prompt`);
    }
    if (!Array.isArray(scenario.assertions) || scenario.assertions.length === 0) {
      errors.push(`${scenario.id ?? where}: must define at least one assertion`);
    } else {
      for (const [j, assertion] of scenario.assertions.entries()) {
        if (!assertion.label) errors.push(`${scenario.id}: assertions[${j}] missing label`);
        if (!assertion.isJudge && typeof assertion.check !== "function") {
          errors.push(`${scenario.id}: assertions[${j}] is not a judge and has no check() function`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("Scenario lint failed:");
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log(`Scenario lint passed: ${scenarios.length} scenario(s), all well-formed.`);
}

async function runLive() {
  const provider = await resolveProvider();
  if (!provider) {
    console.error("No model provider available.");
    console.error("Either install/authenticate the `claude` CLI (used automatically, no key needed),");
    console.error("or set OPENAI_API_KEY, or run with --lint to validate scenario structure only.");
    process.exit(1);
  }
  console.log(`Using provider: ${provider}${process.env.AGENT_EVAL_MODEL ? ` (model: ${process.env.AGENT_EVAL_MODEL})` : ""}\n`);

  const agentsMd = readFileSync(AGENTS_MD_PATH, "utf8");
  const system = buildSystemPrompt(agentsMd);

  const judgeFn = async (question, responseText) => {
    const judgeSystem =
      "You are a strict grader. Given a QUESTION and an AGENT_RESPONSE, answer with exactly one word " +
      "on the first line — PASS or FAIL — then a one-sentence reason on the second line.";
    const judgeUser = `QUESTION: ${question}\n\nAGENT_RESPONSE:\n${responseText}`;
    const verdictText = await callProvider({ system: judgeSystem, user: judgeUser }, { provider });
    const [firstLine, ...rest] = verdictText.trim().split("\n");
    return { pass: /^PASS/i.test(firstLine.trim()), reason: rest.join(" ").trim() };
  };

  const filter = process.env.AGENT_EVAL_SCENARIO_FILTER;
  const selected = filter ? scenarios.filter((s) => s.id.includes(filter)) : scenarios;
  if (filter && selected.length === 0) {
    console.error(`AGENT_EVAL_SCENARIO_FILTER="${filter}" matched no scenario ids.`);
    process.exit(1);
  }

  const scenarioResults = [];
  for (const scenario of selected) {
    let responseText;
    try {
      responseText = await callProvider({ system, user: scenario.prompt }, { provider });
    } catch (err) {
      scenarioResults.push({
        id: scenario.id,
        rule: scenario.rule,
        results: [{ label: "model call", pass: false, message: String(err), isJudge: false, blocking: true }],
        blockingFailures: 1,
      });
      continue;
    }
    scenarioResults.push(await evaluateScenario(scenario, responseText, { judgeFn }));
  }

  const { text, totalBlockingFailures } = formatReport(scenarioResults);
  console.log(text);
  process.exit(totalBlockingFailures > 0 ? 1 : 0);
}

const mode = process.argv[2];
if (mode === "--lint") {
  lintScenarios();
} else {
  await runLive();
}
