// Checks that no personal information enters the public repository (docs/00-requirements.md R-20).
// 1. Every commit author and committer address is on the allow list.
// 2. No published text contains a denied word (real names, names of other activities, and so on):
//    tracked files, all commit messages, and the PR title and body (CI environment variable PR_TEXT).
//    So that the denied words never appear in the public repository, they are read from the environment
//    variable PRIVACY_DENYLIST (a GitHub Secret) or from the untracked file .privacy-denylist (one word per line).
//    If neither is set, this check is skipped with a warning.
// 3. Texts about to be published (an issue body, a review reply) can be checked before posting:
//    `npm run check:privacy -- --text-file <path>` (the option may be repeated).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ALLOWED_EMAILS = new Set([
  "340638804+fukugyononuko@users.noreply.github.com", // commit author (git config)
  "fukugyononuko@gmail.com", // merges on GitHub
  "noreply@github.com", // committer for operations on GitHub
  "49699333+dependabot[bot]@users.noreply.github.com", // Dependabot
]);
const TEXT_FILE = /\.(md|mdx|astro|ts|tsx|js|mjs|cjs|json|ya?ml|txt|css|html|svg)$/;

const textFiles = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--text-file" && i + 1 < args.length) textFiles.push(args[++i]);
  else {
    console.error(`check-privacy: unknown or incomplete argument: ${args[i]} (usage: --text-file <path>, repeatable)`);
    process.exit(2);
  }
}

const problems = [];

const identities = execFileSync("git", ["log", "--format=%ae%n%ce"], { encoding: "utf8" }).split("\n").filter(Boolean);
for (const email of new Set(identities)) {
  if (!ALLOWED_EMAILS.has(email)) problems.push(`commit address not on the allow list: ${email}`);
}

const denylist = (process.env.PRIVACY_DENYLIST ?? (existsSync(".privacy-denylist") ? readFileSync(".privacy-denylist", "utf8") : ""))
  .split("\n")
  .map((w) => w.trim())
  .filter(Boolean);
if (denylist.length === 0 && textFiles.length > 0) {
  // A text checked against nothing must not be reported as OK
  console.error("check-privacy: --text-file given but no denied words configured (PRIVACY_DENYLIST or .privacy-denylist)");
  process.exit(2);
}
if (denylist.length === 0) {
  console.warn("check-privacy: no denied words configured, so the text check was skipped (PRIVACY_DENYLIST or .privacy-denylist)");
} else {
  const sources = [];
  for (const file of execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter((f) => TEXT_FILE.test(f))) {
    sources.push([file, readFileSync(file, "utf8")]);
  }
  const log = execFileSync("git", ["log", "--format=%H%x00%B%x00"], { encoding: "utf8" }).split("\0");
  for (let i = 0; i + 1 < log.length; i += 2) sources.push([`message of commit ${log[i].trim().slice(0, 7)}`, log[i + 1]]);
  if (process.env.PR_TEXT) sources.push(["PR title and body", process.env.PR_TEXT]);
  for (const file of textFiles) sources.push([`text file ${file}`, readFileSync(file, "utf8")]);

  for (const [where, raw] of sources) {
    const text = raw.toLowerCase();
    // Never print the denied word itself (CI logs are public too)
    denylist.forEach((word, i) => {
      if (text.includes(word.toLowerCase())) problems.push(`${where}: contains a denied word (line ${i + 1} of the list)`);
    });
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`check-privacy: OK (${new Set(identities).size} commit addresses, ${denylist.length} denied words, PR text ${process.env.PR_TEXT ? "checked" : "absent"}, ${textFiles.length} text files)`);
