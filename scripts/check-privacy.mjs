// Checks that no personal information enters the public repository (docs/00-requirements.md R-20).
// 1. Every commit author and committer address is on the allow list.
// 2. No published text contains a denied word (real names, names of other activities, and so on):
//    tracked files, all commit messages, and the PR title and body (CI environment variable PR_TEXT).
//    So that the denied words never appear in the public repository, they are read from the environment
//    variable PRIVACY_DENYLIST (a GitHub Secret) or from the untracked file .privacy-denylist (one word per line).
//    If neither is set, this check is skipped with a warning.
// 3. Texts about to be published (an issue body, a review reply) can be checked before posting:
//    `npm run check:privacy -- --text-file <path>` (the option may be repeated).
//
// Nothing this script prints contains a denied word (CI logs are public too), in the same sense the check uses.
// Lines are judged whole, never partly redacted: each message has candidates, from the most helpful (with a
// path or value) to one that names things only by number; the first candidate that contains no denied word is
// printed, and if none qualifies an empty line is printed. Git's own stderr is captured, and unexpected errors
// are reported by a fixed message. Exit codes: 0 OK, 1 a problem was found, 2 the check could not be done.
// Git runs in the caller's Git environment (GIT_DIR and the like are respected, as for any Git command).
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";

const ALLOWED_EMAILS = new Set([
  "340638804+fukugyononuko@users.noreply.github.com", // commit author (git config)
  "fukugyononuko@gmail.com", // merges on GitHub
  "noreply@github.com", // committer for operations on GitHub
  "49699333+dependabot[bot]@users.noreply.github.com", // Dependabot
]);
const TEXT_FILE = /\.(md|mdx|astro|ts|tsx|js|mjs|cjs|json|ya?ml|txt|css|html|svg)$/;

// "Contains" means: each code point lowercased on its own, then substring. Used for detection and for output.
const lower = (text) => Array.from(text, (c) => c.toLowerCase()).join("");
let lowerWords = [];
const containsAny = (text) => {
  const low = lower(text);
  return lowerWords.some((w) => low.includes(w));
};

// Prints the first candidate that contains no denied word, or an empty line if none does.
function emit(stream, ...candidates) {
  const line = candidates.find((c) => !containsAny(c)) ?? "";
  stream.write(`${line}\n`);
}

function fail(code, ...candidates) {
  emit(process.stderr, ...candidates);
  process.exit(code);
}

// git with its stderr captured, so git's own messages (which may quote paths) never reach the log. Variables
// that change how pathspecs are read are dropped, so the fixed ":/" below always means "the whole work tree".
const PATHSPEC_VARS = ["GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"];
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !PATHSPEC_VARS.includes(k)));
const gitRaw = (args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30, env: gitEnv });
const git = (args) => gitRaw(args).toString("utf8");
function splitNul(buf) {
  const parts = [];
  let start = 0;
  for (let i = buf.indexOf(0); i !== -1; i = buf.indexOf(0, start)) {
    if (i > start) parts.push(buf.subarray(start, i));
    start = i + 1;
  }
  if (start < buf.length) parts.push(buf.subarray(start));
  return parts;
}

function main() {
  // Each entry keeps the line it was written on, so diagnostics point at the right line even with blank lines
  const denylist = (process.env.PRIVACY_DENYLIST ?? (existsSync(".privacy-denylist") ? readFileSync(".privacy-denylist", "utf8") : ""))
    .split("\n")
    .map((w, i) => ({ word: w.trim(), line: i + 1 }))
    .filter((e) => e.word);
  lowerWords = denylist.map((e) => lower(e.word));

  const textFiles = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--text-file" && i + 1 < args.length) textFiles.push(args[++i]);
    else
      fail(
        2,
        `check-privacy: unknown or incomplete argument: ${args[i]} (usage: --text-file <path>, repeatable)`,
        `check-privacy: unknown or incomplete argument at position ${i + 1}`,
      );
  }
  if (denylist.length === 0 && textFiles.length > 0) {
    // A text checked against nothing must not be reported as OK
    fail(2, "check-privacy: --text-file given but no denied words configured (PRIVACY_DENYLIST or .privacy-denylist)");
  }

  // Each problem is a list of candidate messages (see emit)
  const problems = [];
  const identities = git(["log", "--format=%ae%n%ce"]).split("\n").filter(Boolean);
  [...new Set(identities)].forEach((email, k) => {
    if (!ALLOWED_EMAILS.has(email)) problems.push([`commit address not on the allow list: ${email}`, `commit address #${k + 1} not on the allow list`]);
  });

  if (denylist.length === 0) {
    emit(process.stderr, "check-privacy: no denied words configured, so the text check was skipped (PRIVACY_DENYLIST or .privacy-denylist)");
  } else {
    // [label, label by number, text]
    const sources = [];
    // Names are kept as raw bytes: -z stops git quoting non-ASCII names, and a Buffer path keeps names that
    // are not valid UTF-8 (allowed on Linux) pointing at the real file. Only the label is decoded.
    // Files are read under Git's own work tree (which GIT_WORK_TREE may move away from the current directory):
    // names are listed relative to its top (--full-name) and joined to it. The pathspec ":/" lists the whole
    // work tree even from a subdirectory. Git runs from the current directory throughout, so relative
    // GIT_DIR / GIT_WORK_TREE values keep their meaning.
    const top = gitRaw(["rev-parse", "--show-toplevel"]);
    const root = Buffer.concat([top.subarray(0, top.at(-1) === 0x0a ? -1 : undefined), Buffer.from("/")]);
    splitNul(gitRaw(["ls-files", "-z", "--full-name", "--", ":/"]))
      .filter((b) => TEXT_FILE.test(b.toString("latin1")))
      .forEach((name, k) => {
        const label = name.toString("utf8");
        let text;
        try {
          const path = Buffer.concat([root, name]);
          // A tracked symbolic link is stored as its link text, so that text is what gets published
          text = lstatSync(path).isSymbolicLink() ? readlinkSync(path, { encoding: "buffer" }).toString("utf8") : readFileSync(path, "utf8");
        } catch {
          fail(2, `check-privacy: cannot read tracked file ${label}`, `check-privacy: cannot read tracked file #${k + 1}`);
        }
        sources.push([label, `tracked file #${k + 1}`, text]);
      });
    const log = git(["log", "--format=%H%x00%B%x00"]).split("\0");
    for (let i = 0; i + 1 < log.length; i += 2) {
      sources.push([`message of commit ${log[i].trim().slice(0, 7)}`, `commit message #${i / 2 + 1}`, log[i + 1]]);
    }
    if (process.env.PR_TEXT) sources.push(["PR title and body", "PR title and body", process.env.PR_TEXT]);
    textFiles.forEach((file, k) => {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        fail(2, `check-privacy: cannot read text file ${file}`, `check-privacy: cannot read text file #${k + 1}`);
      }
      sources.push([`text file ${file}`, `text file #${k + 1}`, text]);
    });

    for (const [label, byNumber, raw] of sources) {
      const low = lower(raw);
      lowerWords.forEach((word, i) => {
        if (low.includes(word)) {
          const what = `contains a denied word (line ${denylist[i].line} of the list)`;
          problems.push([`${label}: ${what}`, `${byNumber}: ${what}`]);
        }
      });
    }
  }

  if (problems.length > 0) {
    for (const candidates of problems) emit(process.stderr, ...candidates);
    process.exit(1);
  }
  emit(
    process.stdout,
    `check-privacy: OK (${new Set(identities).size} commit addresses, ${denylist.length} denied words, PR text ${process.env.PR_TEXT ? "checked" : "absent"}, ${textFiles.length} text files)`,
  );
}

try {
  main();
} catch {
  // The error's own message may quote paths or git output; report it by a fixed message
  fail(2, "check-privacy: the check could not be completed (unexpected error)");
}
