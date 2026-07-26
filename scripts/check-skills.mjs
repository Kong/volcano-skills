#!/usr/bin/env node
// Validates the skill catalog before we notify downstream consumers.
//
// Catches the realistic "bad skill" failures at the source: malformed
// index.json, a catalog entry with no SKILL.md, a SKILL.md with missing/empty
// frontmatter, name mismatch, description drift between index.json and the
// SKILL.md frontmatter, a skill dir that was never registered in the catalog,
// and setup CTA examples whose expected skills have no discovery signal in
// their frontmatter. CI gates the volcano-agentic-plugins notify dispatch on
// this, so a broken catalog is never propagated downstream.
//
// Pure Node builtins (this repo has no package manager). Run:
//   node scripts/check-skills.mjs
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const err = (m) => errors.push(m);
const triggerCasesFile = path.join(root, "tests", "skill-trigger-cases.json");

// Minimal frontmatter reader: skills use simple single-line `key: value` YAML
// between `---` fences (no nested/multiline values — asserted by this check's
// own frontmatter-shape expectations). Strips one layer of surrounding quotes
// so a quoted and an unquoted description compare equal.
// ponytail: hand-rolled instead of js-yaml — no deps in this repo; upgrade to
// a real YAML parser only if frontmatter ever needs multiline/nested values.
function frontmatter(file) {
  const text = readFileSync(file, "utf8");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const fm = {};
  for (const line of text.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return fm;
}

let index;
try {
  index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8"));
} catch (e) {
  err(`index.json is not valid JSON: ${e.message}`);
}

const registered = new Set();
const registeredDescriptions = new Map();
if (index && !Array.isArray(index.skills)) {
  err('index.json must have a "skills" array');
} else if (index) {
  index.skills.forEach((s, i) => {
    const where = `index.json skills[${i}]`;
    for (const field of ["name", "description", "path"]) {
      if (typeof s?.[field] !== "string" || s[field].trim() === "") {
        err(`${where}: missing/empty "${field}"`);
      }
    }
    if (typeof s?.name !== "string" || s.name === "") return;
    registered.add(s.name);
    if (typeof s.description === "string") {
      registeredDescriptions.set(s.name, s.description);
    }

    const expectedPath = `/skills/${s.name}/SKILL.md`;
    if (s.path !== expectedPath) {
      err(`${where} (${s.name}): path is "${s.path}", expected "${expectedPath}"`);
    }

    const skillFile = path.join(root, s.name, "SKILL.md");
    if (!existsSync(skillFile)) {
      err(`${where} (${s.name}): ${s.name}/SKILL.md does not exist`);
      return;
    }
    const fm = frontmatter(skillFile);
    if (!fm) {
      err(`${s.name}/SKILL.md: missing or malformed "---" frontmatter block`);
      return;
    }
    if (fm.name !== s.name) {
      err(`${s.name}/SKILL.md: frontmatter name "${fm.name}" != index name "${s.name}"`);
    }
    if (!fm.description || fm.description.trim() === "") {
      err(`${s.name}/SKILL.md: frontmatter description is empty`);
    } else if (fm.description !== s.description) {
      err(`${s.name}: description drift between index.json and SKILL.md frontmatter`);
    }
  });
}

// Orphan check: every <dir>/SKILL.md on disk must be registered in index.json,
// so a skill added without a catalog entry fails instead of shipping invisibly.
// Skipped when the catalog didn't parse into a skills array: registered would
// be empty and every skill dir would be misreported as an orphan on top of the
// real "index.json is not valid" error.
if (index && Array.isArray(index.skills)) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (existsSync(path.join(root, entry.name, "SKILL.md")) && !registered.has(entry.name)) {
      err(`${entry.name}/SKILL.md exists but is not registered in index.json`);
    }
  }
}

// Deterministic discovery coverage for user-facing setup prompts. This does
// not claim to reproduce a model's skill-selection behavior. It protects the
// lexical evidence that the model sees before a skill loads: every expected
// skill must exist and its catalog description must share at least one
// declared signal with the prompt.
function normalizeSignal(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
      if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
      return token;
    })
    .join(" ");
}

let triggerCases;
try {
  triggerCases = JSON.parse(readFileSync(triggerCasesFile, "utf8"));
} catch (e) {
  err(`tests/skill-trigger-cases.json is not valid JSON: ${e.message}`);
}

if (triggerCases !== undefined &&
    (triggerCases === null || typeof triggerCases !== "object" || !Array.isArray(triggerCases.cases))) {
  err('tests/skill-trigger-cases.json must have a "cases" array');
} else if (triggerCases !== undefined) {
  const caseIds = new Set();
  triggerCases.cases.forEach((testCase, i) => {
    const where = `tests/skill-trigger-cases.json cases[${i}]`;
    if (typeof testCase?.id !== "string" || testCase.id.trim() === "") {
      err(`${where}: missing/empty "id"`);
    } else if (caseIds.has(testCase.id)) {
      err(`${where}: duplicate id "${testCase.id}"`);
    } else {
      caseIds.add(testCase.id);
    }
    if (typeof testCase?.prompt !== "string" || testCase.prompt.trim() === "") {
      err(`${where}: missing/empty "prompt"`);
      return;
    }
    if (!Array.isArray(testCase.expected) || testCase.expected.length === 0) {
      err(`${where}: "expected" must be a non-empty array`);
      return;
    }

    const expectedNames = new Set(testCase.expected.map((item) => item?.skill));
    for (const mandatory of ["volcano-sdk", "volcano-platform"]) {
      if (!expectedNames.has(mandatory)) {
        err(`${where}: every Volcano build prompt must expect "${mandatory}"`);
      }
    }
    if (![...expectedNames].some((name) => name !== "volcano-sdk" && name !== "volcano-platform")) {
      err(`${where}: expected skills must include at least one domain skill`);
    }

    const normalizedPrompt = normalizeSignal(testCase.prompt);
    testCase.expected.forEach((item, expectedIndex) => {
      const expectedWhere = `${where} expected[${expectedIndex}]`;
      if (typeof item?.skill !== "string" || item.skill.trim() === "") {
        err(`${expectedWhere}: missing/empty "skill"`);
        return;
      }
      if (!registered.has(item.skill)) {
        err(`${expectedWhere}: unknown skill "${item.skill}"`);
        return;
      }
      if (!Array.isArray(item.signals) || item.signals.length === 0 ||
          item.signals.some((signal) => typeof signal !== "string" || signal.trim() === "")) {
        err(`${expectedWhere}: "signals" must be a non-empty array of strings`);
        return;
      }
      if (item.signals.some((signal) => normalizeSignal(signal) === "")) {
        err(`${expectedWhere}: every signal must contain at least one alphanumeric character`);
        return;
      }
      const normalizedDescription = normalizeSignal(registeredDescriptions.get(item.skill) ?? "");
      const matchingSignal = item.signals.find((signal) => {
        const normalized = normalizeSignal(signal);
        return normalizedPrompt.includes(normalized) && normalizedDescription.includes(normalized);
      });
      if (!matchingSignal) {
        err(`${expectedWhere} (${item.skill}): none of [${item.signals.join(", ")}] appears in both prompt and catalog description`);
      }
    });
  });
}

if (errors.length) {
  console.error(`check-skills: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-skills: OK (${registered.size} skills, ${triggerCases?.cases?.length ?? 0} trigger cases)`);
