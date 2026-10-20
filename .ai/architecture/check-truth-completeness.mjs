// Truth Completeness regression — detects "code has a writer the Architecture Truth doesn't know".
// Static, symbol-level reconciliation for the highest-risk resources (client_matches, platform_*,
// live_timers). Never modifies anything.
//
// Detection model (documented boundaries — we do NOT claim 100% coverage):
//   Rule 1 (file level): every file under server/ containing a literal DML statement on a target
//            table must appear in that resource's index evidence. Catches NEW writers in NEW files.
//   Rule 2 (code→index, symbol level): in the flat exported-function DAL files, any exported
//            function whose body contains target-table DML must be named by some index writer
//            target. Catches NEW write functions in EXISTING allowlisted files (the TE-2 class).
//   Rule 3 (index→code, symbol level): every write symbol recorded in index writer targets must
//            still exist in code. Catches STALE index evidence (deleted code still claimed).
//   NOT covered: dynamically composed SQL (string interpolation of table names), non-exported
//   wrappers, writes executed through generic query helpers with runtime-built SQL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, ".ai", "architecture", "index.json"), "utf8"));
const INDEX_TEXT = JSON.stringify(INDEX);

const TARGETS = {
  client_matches: { dml: /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+client_matches\b/gi },
  platform_matches: { dml: /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+platform_matches\b/gi },
  platform_bets: { dml: /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+platform_bets\b/gi },
  live_timers: { dml: /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+live_timers\b/gi },
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}
// Comments belong to the NEXT function; strip them before attribution so JSDoc mentioning
// DML (e.g. "DELETE ... client_matches") is not blamed on the preceding function.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)[ \t]*\/\/[^\n]*/g, "");
}
// Split a (comment-stripped) file into function chunks at every line-start function boundary
// (exported or not), so non-exported helpers break chunks correctly. Only exported functions
// are attributed (internal helpers are covered via their exported wrappers — documented boundary).
function exportedFunctionChunks(cleanText) {
  const re = /^(export\s+)?(?:async\s+)?function\s+(\w+)/gm;
  const marks = [];
  for (const m of cleanText.matchAll(re)) {
    marks.push({ exported: Boolean(m[1]), name: m[2], start: m.index, end: 0 });
  }
  marks.forEach((mk, i) => { mk.end = i + 1 < marks.length ? marks[i + 1].start : cleanText.length; });
  return marks.filter((mk) => mk.exported);
}
const codeFiles = walk(path.join(ROOT, "server"));
const corpus = new Map(codeFiles.map((p) => [p, fs.readFileSync(p, "utf8")]));

function indexEvidencePaths(resourceKey) {
  const res = INDEX.resources[resourceKey];
  const set = new Set();
  if (!res) return set;
  for (const op of res.operations || []) {
    for (const w of op.writers || []) {
      for (const e of w.evidence || []) {
        const m = String(e).match(/^(.*?):[\d]+([,-][\d]+)*$/);
        set.add(m ? m[1] : String(e));
      }
    }
  }
  return set;
}
function indexWriterSymbols(resourceKey) {
  const res = INDEX.resources[resourceKey];
  const syms = new Set();
  if (!res) return syms;
  for (const op of res.operations || []) {
    for (const w of op.writers || []) {
      for (const m of String(w.target).matchAll(/\b((?:write|insert|update|patch|delete|clear|swap|force|prune|mark|archive|replace|save|set|upsert)[A-Z]\w+)\b/g)) {
        syms.add(m[1]);
      }
    }
  }
  return syms;
}

let failures = 0;
const report = [];
for (const [table, cfg] of Object.entries(TARGETS)) {
  const dmlRe = new RegExp(cfg.dml.source, "i");
  const evidenceFiles = indexEvidencePaths(table);
  const indexSymbols = indexWriterSymbols(table);
  const codeSymbols = new Map(); // symbol -> file (write-export symbols found in code)
  const dmlFiles = new Set();

  for (const [abs, text] of corpus.entries()) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (dmlRe.test(text)) dmlFiles.add(rel);
    // Rule 2: flat exported functions whose body chunk mentions table DML
    if (rel.startsWith("rds/")) {
      const clean = stripComments(text);
      for (const mk of exportedFunctionChunks(clean)) {
        const body = clean.slice(mk.start, mk.end);
        if (dmlRe.test(body)) codeSymbols.set(mk.name, rel);
      }
    }
  }

  const problems = [];
  // Rule 1
  for (const f of [...dmlFiles].sort()) {
    if (!evidenceFiles.has(f)) {
      problems.push(`GAP(file): ${f} has literal DML on ${table} but is absent from index evidence`);
    }
  }
  // Rule 2
  for (const [sym, file] of [...codeSymbols.entries()].sort()) {
    if (!INDEX_TEXT.includes(sym)) {
      problems.push(`GAP(symbol): ${sym} (${file}) writes ${table} but no index writer target names it`);
    }
  }
  // Rule 3
  const codeTextAll = [...corpus.values()].join("\n");
  for (const sym of [...indexSymbols].sort()) {
    if (!new RegExp(`\\b${sym}\\b`).test(codeTextAll)) {
      problems.push(`STALE(symbol): index records writer "${sym}" but it no longer exists in server/ code`);
    }
  }

  const status = problems.length === 0 ? "PASS" : "FAIL";
  if (problems.length > 0) failures++;
  report.push(`${status} ${table} (dmlFiles=${dmlFiles.size}, codeWriteSymbols=${codeSymbols.size}, indexWriterSymbols=${indexSymbols.size})`);
  for (const p of problems) report.push(`     ${p}`);
}

report.push("");
report.push("Detection boundary (honest limits): static literal-DML + flat exported-function scan only;");
report.push("dynamic SQL composition, non-exported wrappers, and runtime-built statements are NOT covered.");
report.push("This check catches the TE-2 class (new/changed writer unknown to the index), not every possible write path.");
console.log(report.join("\n"));
process.exit(failures === 0 ? 0 : 1);
