// Tests for check-privacy.mjs.
// Conditions:
// - A text passed with --text-file is reported OK only if it was checked against a non-empty denylist and
//   contains none of the words; anything else exits non-zero.
// - No line the checker prints contains a denied word, wherever the word came from (text, file name, commit address).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Built at run time so the word itself never appears in a tracked file (the checker scans tracked files).
const PLANTED = ["zq", Math.random().toString(36).slice(2, 10), "x"].join("");
const SCRIPT = resolve("scripts/check-privacy.mjs");
const dir = mkdtempSync(join(tmpdir(), "check-privacy-"));
const clean = join(dir, "clean.md");
const dirty = join(dir, "dirty.md");
const named = join(dir, `${PLANTED}.md`);
writeFileSync(clean, "A reply with nothing private in it.\n");
writeFileSync(dirty, `A reply that mentions ${PLANTED} by mistake.\n`);
writeFileSync(named, `Also mentions ${PLANTED}.\n`);

function run(args, denylist = PLANTED, cwd = process.cwd()) {
  const env = { ...process.env, PRIVACY_DENYLIST: denylist };
  delete env.PR_TEXT;
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", env, cwd });
}

describe("check-privacy --text-file", () => {
  it("fails when the text contains a denied word, without printing the word", () => {
    const r = run(["--text-file", dirty]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`text file ${dirty}: contains a denied word`);
    expect(r.stderr + r.stdout).not.toContain(PLANTED);
  });

  it("passes a clean text and reports it as checked", () => {
    const r = run(["--text-file", clean]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 text files");
  });

  it("checks every file when the option is repeated", () => {
    const r = run(["--text-file", clean, "--text-file", dirty]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`text file ${dirty}`);
  });

  it("rejects --text-file without a path", () => {
    expect(run(["--text-file"]).status).toBe(2);
  });

  it("rejects an unknown argument", () => {
    expect(run(["--text", clean]).status).toBe(2);
  });

  it("does not report OK when the denylist is empty", () => {
    const r = run(["--text-file", clean], "");
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain("OK");
  });
});

describe("check-privacy output never contains a denied word", () => {
  it("when the word is in a --text-file path", () => {
    const r = run(["--text-file", named]);
    expect(r.status).toBe(1);
    expect((r.stdout + r.stderr).toLowerCase()).not.toContain(PLANTED);
  });

  it("when the word is in a commit address", () => {
    const repo = mkdtempSync(join(tmpdir(), "check-privacy-repo-"));
    const git = (...a) => execFileSync("git", ["-c", `user.email=${PLANTED}@example.com`, "-c", "user.name=t", ...a], { cwd: repo });
    git("init", "-q");
    writeFileSync(join(repo, "a.md"), "nothing\n");
    git("add", "a.md");
    git("commit", "-q", "-m", "init");
    const r = run([], PLANTED, repo);
    expect(r.status).toBe(1);
    expect((r.stdout + r.stderr).toLowerCase()).not.toContain(PLANTED);
  });

  it("when the word is in an unknown argument", () => {
    const r = run([`--${PLANTED}`]);
    expect(r.status).toBe(2);
    expect((r.stdout + r.stderr).toLowerCase()).not.toContain(PLANTED);
  });

  it("when the word is in the path of a file that cannot be read", () => {
    const r = run(["--text-file", join(dir, `missing-${PLANTED}.md`)]);
    expect(r.status).toBe(2);
    expect((r.stdout + r.stderr).toLowerCase()).not.toContain(PLANTED);
  });

  it("when the denylist spells the word in a different case from the path", () => {
    const r = run(["--text-file", named], PLANTED.toUpperCase());
    expect(r.status).toBe(1);
    expect((r.stdout + r.stderr).toLowerCase()).not.toContain(PLANTED);
  });
});
