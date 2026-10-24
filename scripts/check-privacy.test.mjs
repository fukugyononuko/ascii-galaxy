// Tests for check-privacy.mjs.
// Conditions:
// - A text passed with --text-file is reported OK only if it was checked against a non-empty denylist and
//   contains none of the words; anything else exits non-zero.
// - Nothing the checker prints (stdout or stderr, any line, any exit path) contains any denied word, using the
//   checker's own notion of "contains" (both sides lowercased, then substring).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
// Contains none of the grid's words (not even the letters e or i), so the success line is really printed
const successText = join(dir, "zzz.md");
writeFileSync(successText, "zzz\n");

// A known environment: nothing from the session's Git variables (GIT_DIR, GIT_WORK_TREE, identities, ...)
// and no global or system Git config, so the machine and the session do not matter.
function baseEnv() {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_") && k !== "GIT_CONFIG_GLOBAL" && k !== "GIT_CONFIG_NOSYSTEM") delete env[k];
  delete env.EMAIL;
  delete env.PR_TEXT;
  return env;
}

function makeRepo({ email = ALLOWED, files = { "a.md": "zzz\n" }, removeFromWorktree = [], message = "zzz" } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "check-privacy-repo-"));
  const git = (...a) =>
    execFileSync("git", ["-c", `user.email=${email}`, "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...a], {
      cwd: repo,
      env: baseEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "-q");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
  git("add", "-A");
  git("commit", "-q", "-m", message);
  for (const name of removeFromWorktree) rmSync(join(repo, name));
  return repo;
}

function run(args, denylist = PLANTED, cwd = process.cwd(), timeout = undefined) {
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", env: { ...baseEnv(), PRIVACY_DENYLIST: denylist }, cwd, timeout });
}

const gitIn = (repo, ...a) =>
  execFileSync("git", ["-c", `user.email=${ALLOWED}`, "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...a], {
    cwd: repo,
    env: baseEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

// The checker's own notion of "contains": each code point lowercased on its own, then substring
const lowerEach = (text) => Array.from(text, (c) => c.toLowerCase()).join("");
const contains = (text, word) => lowerEach(text).includes(lowerEach(word));
const leaked = (r, words) => words.filter((w) => contains(r.stdout + r.stderr, w));

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
    const repo = makeRepo({ files: { "a.md": "zzz\n", "gone.md": "x\n" }, removeFromWorktree: ["gone.md"] });
    expect(run([], PLANTED, repo).status).toBe(2);
  });

  it("checks tracked files whose names are not ASCII", () => {
    const repo = makeRepo({ files: { "a.md": "zzz\n", "日本語.md": `${PLANTED}\n`, "é.md": "zzz\n" } });
    const r = run([], PLANTED, repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("日本語.md: contains a denied word");
  });

  it("checks tracked files whose names are not valid UTF-8 (skipped where the file system rejects such names)", (ctx) => {
    const repo = makeRepo();
    const name = Buffer.from([0x62, 0x61, 0x64, 0x2d, 0xff, 0x2e, 0x6d, 0x64]); // "bad-\xff.md"
    try {
      writeFileSync(Buffer.concat([Buffer.from(`${repo}/`), name]), `${PLANTED}\n`);
    } catch {
      ctx.skip(); // e.g. APFS on macOS; runs on Linux CI
    }
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "zzz");
    const r = run([], PLANTED, repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("contains a denied word");
  });

  it("redacts a long line with many case-mapped matches quickly", () => {
    // 40,000 × 3 bytes stays under Linux's 128 KiB limit for one argument (MAX_ARG_STRLEN)
    const r = run([`--${"i̇".repeat(40000)}`], "İ", process.cwd(), 3000);
    expect(r.error).toBeUndefined(); // spawned, and not killed by the timeout
    expect(r.status).toBe(2);
    expect(leaked(r, ["İ"])).toEqual([]);
  });

  it("redacts nested matches quickly", () => {
    const r = run([`--${"a".repeat(20000)}${"b".repeat(20000)}`], "ab", process.cwd(), 3000);
    expect(r.status).toBe(2);
    expect(leaked(r, ["ab"])).toEqual([]);
  });

  it("drops a line whose deletions keep forming new matches", () => {
    // The marker is denied too, so each pass deletes it and joins "a…a" to "b…b" into a new "ab"
    const words = ["ab", "[redacted]"];
    const r = run([`--${"a".repeat(6)}${"b".repeat(6)}`], words.join("\n"), process.cwd(), 3000);
    expect(r.status).toBe(2);
    expect(leaked(r, words)).toEqual([]);
  });

  it("ignores Git variables of the calling session", () => {
    const repo = makeRepo();
    const env = { ...baseEnv(), PRIVACY_DENYLIST: PLANTED, GIT_DIR: join(dir, "not-a-git-dir") };
    // run() and makeRepo() build their own environment; this checks that baseEnv() really drops GIT_DIR
    expect(Object.keys(baseEnv())).not.toContain("GIT_DIR");
    expect(spawnSync("node", [SCRIPT], { encoding: "utf8", env, cwd: repo }).status).toBe(2); // GIT_DIR would break git
    expect(run([], PLANTED, repo).status).toBe(0);
  });
});

// Grid: kinds of denied word × places a word can reach the output. In every cell the word is really put in the
// named place (checked), the exit code is the one that place produces, and nothing printed contains any denied
// word. "input" is how the word is written into the place; it may differ from the denylist entry in case.
describe("check-privacy output never contains a denied word", () => {
  const kinds = {
    planted: { words: [PLANTED] },
    "inside the marker": { words: ["redacted"] },
    "the marker itself": { words: ["[redacted]"] },
    "in fixed messages": { words: ["OK", "check", "text file", "contains"] },
    "one letter": { words: ["e"] },
    // The input holds all three entries, overlapping each other
    overlapping: { words: [`${PLANTED}ab`, "abc", "bc"], input: `${PLANTED}abc`, allPlanted: true },
    // "İ".toLowerCase() is "i" + U+0307 (two code points); the input uses that lowercase form
    "Unicode case": { words: ["İ"], input: "i̇" },
  };
  let n = 0;
  const places = {
    "text content": (w) => {
      const p = join(dir, `content-${++n}.md`);
      writeFileSync(p, `has ${w} inside\n`);
      return { args: ["--text-file", p], status: 1, planted: [`has ${w} inside`] };
    },
    "text file path": (w) => {
      const p = join(dir, `path-${++n}-${w}.md`);
      writeFileSync(p, `has ${w} inside\n`);
      return { args: ["--text-file", p], status: 1, planted: [p] };
    },
    "commit address": (w) => {
      const email = `${w}x@example.com`;
      return { cwd: makeRepo({ email }), status: 1, planted: [email] };
    },
    "unknown argument": (w) => ({ args: [`--${w}`], status: 2, planted: [`--${w}`] }),
    "unreadable text file": (w) => {
      const p = join(dir, `missing-${++n}-${w}.md`);
      return { args: ["--text-file", p], status: 2, planted: [p], missing: p };
    },
    "tracked file missing from the worktree": (w) => {
      const name = `gone-${w}.md`;
      return { cwd: makeRepo({ files: { "a.md": "zzz\n", [name]: "x\n" }, removeFromWorktree: [name] }), status: 2, planted: [name] };
    },
    "success line": () => ({ args: ["--text-file", successText], status: 0, planted: [] }),
  };

  for (const [kind, { words, input, allPlanted }] of Object.entries(kinds)) {
    for (const [place, make] of Object.entries(places)) {
      it(`${kind} × ${place}`, () => {
        const w = input ?? words[0];
        const { args = [], cwd = makeRepo(), status, planted, missing } = make(w);
        // the word (every word, for the overlapping kind) is really there
        for (const text of planted) for (const word of allPlanted ? words : [words[0]]) expect(contains(text, word)).toBe(true);
        if (missing) expect(existsSync(missing)).toBe(false);
        const r = run(args, words.join("\n"), cwd);
        expect(r.status).toBe(status);
        expect(leaked(r, words)).toEqual([]);
      });
    }
  }
});
