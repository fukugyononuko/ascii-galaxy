// Tests for check-privacy.mjs.
// Conditions:
// - A text passed with --text-file is reported OK only if it was checked against a non-empty denylist and
//   contains none of the words; anything else exits non-zero.
// - Nothing the checker prints (stdout or stderr, any line, any exit path) contains any denied word, using the
//   checker's own notion of "contains" (both sides lowercased, then substring).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), text);
  }
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

// Cells create Git repositories and start Node; on a busy machine that can pass Vitest's 5 s default. The
// performance tests keep their own 3 s limit on the checker process.
const SLOW = { timeout: 20000 };

describe("check-privacy --text-file", SLOW, () => {
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
    expect(r.error?.code).toBeUndefined(); // spawned (no E2BIG), and not killed by the timeout (no ETIMEDOUT)
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

  it("handles a long denied word with many overlapping matches quickly", () => {
    const r = run([`--${"i̇".repeat(40000)}`], "İ".repeat(19000), process.cwd(), 3000);
    expect(r.error?.code).toBeUndefined();
    expect(r.status).toBe(2);
    expect(leaked(r, ["İ".repeat(19000)])).toEqual([]);
  });

  it("reads tracked files from Git's work tree, not from the current directory", () => {
    const a = makeRepo({ files: { "a.md": "zzz\n" } });
    const b = makeRepo({ files: { "a.md": `${PLANTED}\n` } });
    const env = { ...baseEnv(), PRIVACY_DENYLIST: PLANTED, GIT_DIR: join(b, ".git"), GIT_WORK_TREE: b };
    const r = spawnSync("node", [SCRIPT], { encoding: "utf8", env, cwd: a });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("a.md: contains a denied word");
  });

  it("reads tracked files when GIT_DIR and GIT_WORK_TREE are relative to a nested caller directory", () => {
    const repo = makeRepo({ files: { "a.md": `${PLANTED}\n` } });
    const caller = join(mkdtempSync(join(tmpdir(), "check-privacy-caller-")), "caller", "deep");
    mkdirSync(caller, { recursive: true });
    const env = { ...baseEnv(), PRIVACY_DENYLIST: PLANTED, GIT_DIR: relative(caller, join(repo, ".git")), GIT_WORK_TREE: relative(caller, repo) };
    expect(env.GIT_DIR.startsWith("..")).toBe(true); // really relative
    const r = spawnSync("node", [SCRIPT], { encoding: "utf8", env, cwd: caller });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("a.md: contains a denied word");
  });

  it("checks the whole work tree when run from a subdirectory", () => {
    const repo = makeRepo({ files: { "top.md": `${PLANTED}\n`, "sub/inner.md": "zzz\n" } });
    const r = run([], PLANTED, join(repo, "sub"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("top.md: contains a denied word");
  });

  it("lists every tracked file even when the caller sets pathspec-mode variables", () => {
    const repo = makeRepo({ files: { "leak.md": `${PLANTED}\n` } });
    for (const v of ["GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"]) {
      const env = { ...baseEnv(), PRIVACY_DENYLIST: PLANTED, [v]: "1" };
      const r = spawnSync("node", [SCRIPT], { encoding: "utf8", env, cwd: repo });
      expect(r.status, v).toBe(1);
    }
  });

  it("checks the link text of a tracked symbolic link, not the file it points to", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, `${PLANTED}-target`), "zzz\n"); // clean, untracked
    symlinkSync(`${PLANTED}-target`, join(repo, "link.md"));
    gitIn(repo, "add", "link.md");
    gitIn(repo, "commit", "-q", "-m", "zzz");
    const r = run([], PLANTED, repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("link.md: contains a denied word");
  });

  it("reports the denylist line number as written, counting blank lines", () => {
    const r = run(["--text-file", dirty], `\n  \n${PLANTED}`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("(line 3 of the list)");
  });

  // The checker itself respects GIT_DIR like any Git command; the tests must not inherit the session's value
  it("test helpers drop Git variables of the calling session", () => {
    const repo = makeRepo();
    const env = { ...baseEnv(), PRIVACY_DENYLIST: PLANTED, GIT_DIR: join(dir, "not-a-git-dir") };
    expect(Object.keys(baseEnv())).not.toContain("GIT_DIR");
    expect(spawnSync("node", [SCRIPT], { encoding: "utf8", env, cwd: repo }).status).toBe(2); // GIT_DIR would break git
    expect(run([], PLANTED, repo).status).toBe(0);
  });
});

// Grid: kinds of denied word × places a word can reach the output. In every cell the word is really put in the
// named place (checked), the exit code is the one that place produces, and nothing printed contains any denied
// word. "input" is how the word is written into the place; it may differ from the denylist entry in case.
describe("check-privacy output never contains a denied word", SLOW, () => {
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
    // The words reach this line only through its fixed text, so the cell exists only for kinds whose word
    // appears in that text (see `applies` below)
    "success line": () => ({ args: ["--text-file", successText], status: 0, planted: [SUCCESS_TEXT] }),
  };
  const SUCCESS_TEXT = "check-privacy: OK (commit addresses, denied words, PR text absent, text files)";
  const applies = (place, w) => place !== "success line" || contains(SUCCESS_TEXT, w);

  for (const [kind, { words, input, allPlanted }] of Object.entries(kinds)) {
    for (const [place, make] of Object.entries(places)) {
      if (!applies(place, input ?? words[0])) continue;
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
