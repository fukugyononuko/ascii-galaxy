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

// One notion of "contains", shared by detection and by safe(): each code point lowercased on its own, then
// substring. lowerMap() also records, for every lowercase unit, the code point of the original it came from
// (lowercasing can change length: "İ" becomes "i" + U+0307), so a match maps back to an exact original span.
function lowerMap(text) {
  let lower = "";
  const from = [];
  const to = [];
  for (let p = 0; p < text.length; ) {
    const cp = text.codePointAt(p);
    const len = cp > 0xffff ? 2 : 1;
    const s = String.fromCodePoint(cp).toLowerCase();
    for (let k = 0; k < s.length; k++) {
      from.push(p);
      to.push(p + len);
    }
    lower += s;
    p += len;
  }
  return { lower, from, to };
}
const lower = (text) => lowerMap(text).lower;
let lowerWords = [];
const containsAny = (text) => {
  const low = lower(text);
  return lowerWords.some((w) => low.includes(w));
};

// Returns the line with no denied word in it, in the same sense the check uses. Matches become MARKER first
// (readable output). Then each pass finds every remaining match in one scan and deletes all of their original
// spans (inside the marker, where parts meet, or through case mapping). Deleting can join parts into a new
// match, so after a few passes a line that still contains a word is dropped entirely. Work is linear in the
// line length per pass, and the result never contains a denied word.
function safe(line) {
  let out = String(line);
  for (const word of denylist) out = out.replace(new RegExp(escapeRegExp(word), "giu"), MARKER);
  for (let pass = 0; pass < 3; pass++) {
    const { lower: low, from, to } = lowerMap(out);
    const cut = new Uint8Array(out.length);
    let found = false;
    for (const w of lowerWords) {
      for (let k = low.indexOf(w); k !== -1; k = low.indexOf(w, k + 1)) {
        found = true;
        cut.fill(1, from[k], to[k + w.length - 1]);
      }
    }
    if (!found) return out;
    let next = "";
    for (let q = 0; q < out.length; q++) if (!cut[q]) next += out[q];
    out = next;
  }
  return containsAny(out) ? "" : out;
}

function emit(stream, line) {
  stream.write(`${safe(line)}\n`);
}

function fail(code, line) {
  emit(process.stderr, line);
  process.exit(code);
}

// git with its stderr captured, so git's own messages (which may quote paths) never reach the log
const gitRaw = (args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });
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
  denylist = (process.env.PRIVACY_DENYLIST ?? (existsSync(".privacy-denylist") ? readFileSync(".privacy-denylist", "utf8") : ""))
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);
  lowerWords = denylist.map(lower);

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
    // Names are kept as raw bytes: -z stops git quoting non-ASCII names, and a Buffer path keeps names that
    // are not valid UTF-8 (allowed on Linux) pointing at the real file. Only the label is decoded.
    for (const name of splitNul(gitRaw(["ls-files", "-z"])).filter((b) => TEXT_FILE.test(b.toString("latin1")))) {
      const label = name.toString("utf8");
      let text;
      try {
        text = readFileSync(name, "utf8");
      } catch {
        fail(2, `check-privacy: cannot read tracked file ${label}`);
      }
      sources.push([label, text]);
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
      const low = lower(raw);
      lowerWords.forEach((word, i) => {
        if (low.includes(word)) problems.push(`${where}: contains a denied word (line ${i + 1} of the list)`);
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
