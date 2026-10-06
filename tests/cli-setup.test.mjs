import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const skill = readFileSync(new URL("../install-volcano/SKILL.md", import.meta.url), "utf8");
const blocks = [...skill.matchAll(/```sh\n([\s\S]*?)\n\s*```/g)].map((m) => m[1]);
assert.equal(blocks.length, 3, "probe, install and exact-version verification must be runnable");

test("documented setup clears both download overrides and detects a shadowed CLI", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "volcano-setup-test-"));
  try {
    const current = path.join(temp, "npm-bin");
    const old = path.join(temp, "old-bin");
    mkdirSync(current);
    mkdirSync(old);
    const guard = `#!/bin/sh
if [ "\${VOLCANO_GITHUB_RELEASES_URL+x}" = x ] || [ "\${VOLCANO_CLI_RELEASES_URL+x}" = x ]; then
  echo 'unchecked download override reached child process' >&2
  exit 90
fi
`;
    writeFileSync(path.join(current, "volcano"), guard + "printf '%s\\n' \"${MOCK_VERSION_OUTPUT:-volcano 0.38.0 (commit abc, built today)}\"\n", { mode: 0o755 });
    writeFileSync(path.join(old, "volcano"), guard + "echo 'volcano 0.1.0 (commit old, built yesterday)'\n", { mode: 0o755 });
    writeFileSync(path.join(current, "npm"), guard + '[ "$*" = "install --global @volcano.dev/cli@0.38.0 --registry=https://registry.npmjs.org" ]\n', { mode: 0o755 });
    const run = (script, extra = {}) => spawnSync("/bin/sh", ["-c", script.replaceAll("EXACT_VERSION", "0.38.0")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${current}:/usr/bin:/bin`, VOLCANO_GITHUB_RELEASES_URL: "http://untrusted.invalid", VOLCANO_CLI_RELEASES_URL: "http://other.invalid", ...extra },
    });
    for (const block of blocks) {
      const result = run(block);
      assert.equal(result.status, 0, result.stderr);
    }
    // Prove the fixture would catch the unprotected first probe/install.
    assert.equal(run("volcano --version").status, 90);
    assert.equal(run("npm install").status, 90);
    const mismatch = run(blocks[2], { PATH: `${old}:${current}:/usr/bin:/bin` });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /setup incomplete/);
    for (const output of ["volcano 0.38.0-beta (commit abc, built today)", "unknown output", "volcano 0.38.1 (commit abc, built today)"]) {
      assert.equal(run(blocks[2], { MOCK_VERSION_OUTPUT: output }).status, 1);
    }
    assert.equal(run(blocks[2], { MOCK_VERSION_OUTPUT: "volcano v0.38.0 (commit abc, built today)" }).status, 0);
    // Every alternate entrypoint must protect its own first version probe.
    for (const relative of ["../AGENTS.md", "../volcano-sdk/SKILL.md", "../volcano-platform/SKILL.md"]) {
      const text = readFileSync(new URL(relative, import.meta.url), "utf8");
      const probe = [...text.matchAll(/`([^`\n]*volcano --version)`/g)][0]?.[1];
      assert.ok(probe, relative);
      assert.equal(run(probe).status, 0, `${relative} exposes the first probe to overrides`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
