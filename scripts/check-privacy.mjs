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
// Nothing this script prints contains a denied word (CI logs are public too). The denylist is loaded first,
// every line goes out through emit(), git's own stderr is captured, and unexpected errors are reported by a
// fixed line. Exit codes: 0 OK, 1 a problem was found, 2 the check could not be done.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ALLOWED_EMAILS = new Set([
  "340638804+fukugyononuko@users.noreply.github.com", // commit author (git config)
  "fukugyononuko@gmail.com", // merges on GitHub
  "noreply@github.com", // committer for operations on GitHub
  "49699333+dependabot[bot]@users.noreply.github.com", // Dependabot
]);
const TEXT_FILE = /\.(md|mdx|astro|ts|tsx|js|mjs|cjs|json|ya?ml|txt|css|html|svg)$/;
const MARKER = "[redacted]";

let denylist = [];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One notion of "contains", shared by detection and by safe(): both sides lowercased, then substring.
const contains = (text, word) => text.toLowerCase().includes(word.toLowerCase());

// The shortest span [i, j) of text that contains word in the sense above. Lowercasing can change length
// (e.g. "İ" becomes two code points), so the span is searched on the original text, not mapped from indexes.
function span(text, word) {
  let j = 1;
  while (!contains(text.slice(0, j), word)) j++;
  let i = j - 1;
  while (!contains(text.slice(i, j), word)) i--;
  return [i, j];
}

// Returns the line with no denied word in it, in the same sense the check uses. Matches become MARKER first
// (readable output); then, while any denied word is still contained (inside the marker, where two parts meet,
// or through case mapping), its shortest span is deleted. Each deletion shortens the line, so the loop ends,
// and it ends only when no denied word is contained.
function safe(line) {
  let out = String(line);
  for (const word of denylist) out = out.replace(new RegExp(escapeRegExp(word), "giu"), MARKER);
  for (;;) {
    const word = denylist.find((w) => contains(out, w));
    if (word === undefined) return out;
    const [i, j] = span(out, word);
    out = out.slice(0, i) + out.slice(j);
  }
}

function emit(stream, line) {
  stream.write(`${safe(line)}\n`);
}

function fail(code, line) {
  emit(process.stderr, line);
  process.exit(code);
}

// git with its stderr captured, so git's own messages (which may quote paths) never reach the log
const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function main() {
  denylist = (process.env.PRIVACY_DENYLIST ?? (existsSync(".privacy-denylist") ? readFileSync(".privacy-denylist", "utf8") : ""))
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);

  const textFiles = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--text-file" && i + 1 < args.length) textFiles.push(args[++i]);
    else fail(2, `check-privacy: unknown or incomplete argument: ${args[i]} (usage: --text-file <path>, repeatable)`);
  }
  if (denylist.length === 0 && textFiles.length > 0) {
    // A text checked against nothing must not be reported as OK
    fail(2, "check-privacy: --text-file given but no denied words configured (PRIVACY_DENYLIST or .privacy-denylist)");
  }

  const problems = [];
  const identities = git(["log", "--format=%ae%n%ce"]).split("\n").filter(Boolean);
  for (const email of new Set(identities)) {
    if (!ALLOWED_EMAILS.has(email)) problems.push(`commit address not on the allow list: ${email}`);
  }

  if (denylist.length === 0) {
    emit(process.stderr, "check-privacy: no denied words configured, so the text check was skipped (PRIVACY_DENYLIST or .privacy-denylist)");
  } else {
    const sources = [];
    // -z gives raw names; without it git quotes non-ASCII names ("\303\251.md") and they would be skipped
    for (const file of git(["ls-files", "-z"]).split("\0").filter((f) => TEXT_FILE.test(f))) {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        fail(2, `check-privacy: cannot read tracked file ${file}`);
      }
      sources.push([file, text]);
    }
    const log = git(["log", "--format=%H%x00%B%x00"]).split("\0");
    for (let i = 0; i + 1 < log.length; i += 2) sources.push([`message of commit ${log[i].trim().slice(0, 7)}`, log[i + 1]]);
    if (process.env.PR_TEXT) sources.push(["PR title and body", process.env.PR_TEXT]);
    for (const file of textFiles) {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        fail(2, `check-privacy: cannot read text file ${file}`);
      }
      sources.push([`text file ${file}`, text]);
    }

    for (const [where, raw] of sources) {
      denylist.forEach((word, i) => {
        if (contains(raw, word)) problems.push(`${where}: contains a denied word (line ${i + 1} of the list)`);
      });
    }
  }

  if (problems.length > 0) {
    for (const p of problems) emit(process.stderr, p);
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
  // The error's own message may quote paths or git output; report it by a fixed line
  fail(2, "check-privacy: the check could not be completed (unexpected error)");
}
