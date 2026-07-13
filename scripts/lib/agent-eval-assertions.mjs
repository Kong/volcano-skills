/**
 * Deterministic assertion primitives for the agent-behavior eval harness.
 *
 * Each assertion takes the agent's raw response text and returns
 * { pass: boolean, message: string }. Assertions never call a model — they
 * are pure string/regex checks so they can be unit-tested without network
 * access or API keys (see eval-agent-guidance-selftest.mjs).
 */

/** Extract every line that starts with "Next:" (case-sensitive per the spec). */
export function nextStepLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Next:"));
}

export function mustMatch(regex, label) {
  return {
    label: label ?? `must match ${regex}`,
    check(text) {
      const pass = regex.test(text);
      return {
        pass,
        message: pass ? "matched" : `expected text to match ${regex}`,
      };
    },
  };
}

export function mustNotMatch(regex, label) {
  return {
    label: label ?? `must not match ${regex}`,
    check(text) {
      const pass = !regex.test(text);
      return {
        pass,
        message: pass ? "did not match (expected)" : `unexpected match for ${regex}`,
      };
    },
  };
}

export function mustContainAllOf(substrings, label) {
  return {
    label: label ?? `must contain all of: ${substrings.join(", ")}`,
    check(text) {
      const missing = substrings.filter((s) => !text.includes(s));
      return {
        pass: missing.length === 0,
        message: missing.length === 0 ? "all present" : `missing: ${missing.join(", ")}`,
      };
    },
  };
}

export function mustNotContainAnyOf(substrings, label) {
  return {
    label: label ?? `must not contain any of: ${substrings.join(", ")}`,
    check(text) {
      const present = substrings.filter((s) => text.includes(s));
      return {
        pass: present.length === 0,
        message: present.length === 0 ? "none present (expected)" : `unexpectedly present: ${present.join(", ")}`,
      };
    },
  };
}

/** Exactly one line starting with "Next:", on its own line, per the spec. */
export function exactlyOneNextStepLine(label) {
  return {
    label: label ?? "exactly one 'Next:' line",
    check(text) {
      const lines = nextStepLines(text);
      const pass = lines.length === 1;
      return {
        pass,
        message: pass ? "exactly one Next: line" : `found ${lines.length} Next: line(s): ${JSON.stringify(lines)}`,
      };
    },
  };
}

/**
 * The single Next: line must contain all required substrings and none of the
 * forbidden ones. Fails (with a clear message) if there isn't exactly one
 * Next: line to check.
 */
export function nextStepLineContains({ allOf = [], noneOf = [] } = {}, label) {
  return {
    label: label ?? "Next: line content",
    check(text) {
      const lines = nextStepLines(text);
      if (lines.length !== 1) {
        return { pass: false, message: `expected exactly one Next: line, found ${lines.length}` };
      }
      const [line] = lines;
      const missing = allOf.filter((s) => !line.includes(s));
      const present = noneOf.filter((s) => line.includes(s));
      const pass = missing.length === 0 && present.length === 0;
      const parts = [];
      if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
      if (present.length) parts.push(`unexpectedly present: ${present.join(", ")}`);
      return { pass, message: pass ? "ok" : parts.join("; "), detail: line };
    },
  };
}

/**
 * Heuristic guard against a Next: line offering more than one alternative
 * action (e.g. "check it with X or by doing Y"), which contradicts the
 * "one concrete next-step suggestion" rule.
 */
export function nextStepLineIsSingleAction(label) {
  return {
    label: label ?? "Next: line offers exactly one action",
    check(text) {
      const lines = nextStepLines(text);
      if (lines.length !== 1) {
        return { pass: false, message: `expected exactly one Next: line, found ${lines.length}` };
      }
      const [line] = lines;
      // " or " joining two backticked commands, or "either ... or ..." phrasing.
      const multiOption = /`[^`]+`\s+or\s+(by\s+)?[a-z]/i.test(line) || /\beither\b/i.test(line);
      return {
        pass: !multiOption,
        message: multiOption ? `Next: line appears to offer multiple options: ${line}` : "single action",
        detail: line,
      };
    },
  };
}

/** Optional LLM-judge assertion. Advisory by default (see runner STRICT mode). */
export function judge(question, { blocking = false } = {}) {
  return {
    label: `judge: ${question}`,
    isJudge: true,
    blocking,
    question,
  };
}
