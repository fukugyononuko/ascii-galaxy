// Tests for the --text-file option of check-privacy.mjs.
// Condition: a text passed with --text-file is reported OK only if it was checked against a non-empty
// denylist and contains none of the words; anything else exits non-zero.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PLANTED = "zqxplantedword";
const dir = mkdtempSync(join(tmpdir(), "check-privacy-"));
const clean = join(dir, "clean.md");
const dirty = join(dir, "dirty.md");
writeFileSync(clean, "A reply with nothing private in it.\n");
writeFileSync(dirty, `A reply that mentions ${PLANTED} by mistake.\n`);

function run(args, denylist = PLANTED) {
  const env = { ...process.env, PRIVACY_DENYLIST: denylist };
  delete env.PR_TEXT;
  return spawnSync("node", ["scripts/check-privacy.mjs", ...args], { encoding: "utf8", env });
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
