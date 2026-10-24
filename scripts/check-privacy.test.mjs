// Tests for check-privacy.mjs.
// Conditions:
// - A text passed with --text-file is reported OK only if it was checked against a non-empty denylist and
//   contains none of the words; anything else exits non-zero.
// - Nothing the checker prints (stdout or stderr, any line, any exit path) contains any denied word.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Built at run time so the word itself never appears in a tracked file (the checker scans tracked files).
const PLANTED = ["zq", Math.random().toString(36).slice(2, 10), "x"].join("");
const SCRIPT = resolve("scripts/check-privacy.mjs");
const ALLOWED = "340638804+fukugyononuko@users.noreply.github.com";
const dir = mkdtempSync(join(tmpdir(), "check-privacy-"));
const clean = join(dir, "clean.md");
const dirty = join(dir, "dirty.md");
writeFileSync(clean, "A reply with nothing private in it.\n");
writeFileSync(dirty, `A reply that mentions ${PLANTED} by mistake.\n`);
// Contains none of the grid's words (not even the letter e), so the success line is really printed
const successText = join(dir, "zzz.md");
writeFileSync(successText, "zzz\n");

// Git runs with no global or system config and no identity from the environment, so the machine does not matter.
function gitEnv() {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) delete env[k];
  return env;
}

function makeRepo({ email = ALLOWED, files = { "a.md": "nothing\n" }, removeFromWorktree = [], message = "init" } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "check-privacy-repo-"));
  const git = (...a) =>
    execFileSync("git", ["-c", `user.email=${email}`, "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...a], {
      cwd: repo,
      env: gitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "-q");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
  git("add", "-A");
  git("commit", "-q", "-m", message);
  for (const name of removeFromWorktree) rmSync(join(repo, name));
  return repo;
}

function run(args, denylist = PLANTED, cwd = process.cwd()) {
  const env = { ...process.env, PRIVACY_DENYLIST: denylist };
  delete env.PR_TEXT;
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", env, cwd });
}

function leaked(r, words) {
  const out = (r.stdout + r.stderr).toLowerCase();
  return words.filter((w) => out.includes(w.toLowerCase()));
}

describe("check-privacy --text-file", () => {
  it("fails when the text contains a denied word, without printing the word", () => {
    const r = run(["--text-file", dirty]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("dirty.md: contains a denied word");
    expect(leaked(r, [PLANTED])).toEqual([]);
  });

  it("passes a clean text and reports it as checked", () => {
    const r = run(["--text-file", clean]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 text files");
  });

  it("checks every file when the option is repeated (word in the second file)", () => {
    const r = run(["--text-file", clean, "--text-file", dirty]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("dirty.md");
  });

  it("checks every file when the option is repeated (word in the first file)", () => {
    const r = run(["--text-file", dirty, "--text-file", clean]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("dirty.md");
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

  it("stops with exit 2 when a tracked file cannot be read", () => {
    const repo = makeRepo({ files: { "a.md": "nothing\n", "gone.md": "x\n" }, removeFromWorktree: ["gone.md"] });
    expect(run([], PLANTED, repo).status).toBe(2);
  });
});

// Grid: kinds of denied word × places a word can reach the output. For every cell, nothing printed contains
// any denied word. The kinds include words inside the redaction marker and inside the checker's own fixed
// messages, a one-letter word, and overlapping words.
describe("check-privacy output never contains a denied word", () => {
  const kinds = {
    planted: [PLANTED],
    "inside the marker": ["redacted"],
    "the marker itself": ["[redacted]"],
    "in fixed messages": ["OK", "check", "text file", "contains"],
    "one letter": ["e"],
    overlapping: [`${PLANTED}ab`, "abc", "bc"],
  };
  const places = {
    "text content": (w) => ({ args: ["--text-file", file(`content-${w}`, `has ${w} inside\n`, "plain")] }),
    "text file path": (w) => ({ args: ["--text-file", file(`path-${w}`, `has ${w} inside\n`, w)] }),
    "commit address": (w) => ({ cwd: makeRepo({ email: `${w.replace(/[^a-z0-9]/gi, "")}x@example.com` }) }),
    "unknown argument": (w) => ({ args: [`--${w}`] }),
    "unreadable text file": (w) => ({ args: ["--text-file", join(dir, `missing-${w}.md`)] }),
    "tracked file missing from the worktree": (w) => {
      const name = `gone-${w.replace(/[^a-z0-9]/gi, "")}.md`;
      return { cwd: makeRepo({ files: { "a.md": "nothing\n", [name]: "x\n" }, removeFromWorktree: [name] }) };
    },
    "success line": () => ({ args: ["--text-file", successText] }),
  };

  // Each cell runs in a fresh repository whose tracked files, commit message, and author contain none of the
  // words (except where the place puts one there), so the path under test is the one that prints.
  for (const [kind, words] of Object.entries(kinds)) {
    for (const [place, make] of Object.entries(places)) {
      it(`${kind} × ${place}`, () => {
        const { args = [], cwd = makeRepo({ files: { "a.md": "zzz\n" }, message: "zzz" }) } = make(words[0]);
        const r = run(args, words.join("\n"), cwd);
        if (place === "success line") expect(r.status).toBe(0); // the OK line was really printed
        else expect([1, 2]).toContain(r.status);
        expect(leaked(r, words)).toEqual([]);
      });
    }
  }
});

let fileCount = 0;
function file(tag, text, nameWord) {
  const name = `${++fileCount}-${nameWord}.md`.replace(/[/\\]/g, "_");
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
}
