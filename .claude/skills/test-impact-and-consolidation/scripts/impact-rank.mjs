// Rank test suites by how much unique ground they cover, and propose what to merge.
//
// What each suite gets:
//   reach    how many source lines it executes
//   unique   lines ONLY it executes — the lower this is, the more replaceable it looks
//   subjects which source modules the suite is really about (most of its reach)
//   flags    why coverage cannot judge it: subprocess / config / docs / types
//   wide     so big that any break turns it red without saying which part broke
//
// The five stderr queues form a funnel, from act to hands-off:
//   merge queue        keep the bigger suite, absorb the smaller one into it
//   refused            same idea, but the only container is itself unreadable to the method
//   read-first review  flagged suites whose lines live almost entirely inside one peer;
//                      coverage says duplicate, the flag says check why first
//   subsumed           clean suspects — send these through mutation adjudication
//   blind              everything else; reading is the only judge here
//
// Overlap alone proves nothing: two suites can run the same lines and assert different things.
// Always confirm queue members with mutation-adjudicate.mjs and your own reading.
//
// Usage:
//   REPO=/abs/worktree bun impact-rank.mjs /abs/out [--json] [--containment T]

import { readdir } from "#src/meta/filesystem.ts";
import path from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";

const root = path.resolve(Bun.argv[2] ?? "test-impact");
const covRoot = path.join(root, "cov");
const OVERHEAD_LINES = 14;
const WIDE_REACH = 5000;
const WIDE_SUBJECTS = 12;
// Mark non-zero and timed-out suites invalid. Their coverage still enters the aggregate counts
// below, so a harvest with failures cannot establish unique ownership; rerun it before removal.
const meta = new Map();
const invalid = new Set();
const reach = new Map();
const FLAG_RULES = [
  ["subprocess", /Bun\.spawn|spawnSync|spawnTextSync|execTextSync/],
  ["config", /package\.json|bunfig\.toml|bun\.lock|\.bun-version|\.githooks|workflows\/|\.zshrc/],
  ["docs", /\.claude\/|\.agents\/|README|notes\//],
  ["types", /@ts-expect-error/],
];

const rows = [];
const owners = new Map();
const flagArg = (name, dflt) => {
  const i = Bun.argv.indexOf(name);
  return i >= 0 ? Number(Bun.argv[i + 1]) : dflt;
};
const CONTAINMENT = flagArg("--containment", 0.85);
const REVIEW_CONTAINMENT = flagArg("--review-containment", 0.6);
const asJson = Bun.argv.includes("--json");
const repo = Bun.env.REPO ?? "";

let runs;
try {
  runs = JSON.parse(await Bun.file(path.join(root, "runs.json")).text());
} catch {
  console.error(`refusing to rank: ${path.join(root, "runs.json")} is absent, so the harvest is unfinished`);
  runtimeProcess.exit(1);
}

for (const run of runs) {
  const rel = String(run.file).replaceAll("__", "/");
  meta.set(rel, { ms: run.ms ?? 0, tests: run.tests ?? null });
  if ((run.exit ?? 0) !== 0 || run.timedOut === true) invalid.add(rel);
}

for (const dir of (await readdir(covRoot)).sort()) {
  const rel = dir.replaceAll("__", "/");
  const set = new Set();
  const moduleCount = new Map();
  try {
    const lcov = await Bun.file(path.join(covRoot, dir, "lcov.info")).text();
    let source = null;
    for (const line of lcov.split("\n")) {
      if (line === "end_of_record") {
        source = null;
        continue;
      }
      if (line.startsWith("SF:")) {
        source = repo === "" ? line.slice(3) : path.relative(repo, line.slice(3));
        continue;
      }
      if (source === null || !/^(src|tools|vendor|starters|packages)\//.test(source)) continue;
      if (!line.startsWith("DA:")) continue;
      const [lineNumber, count] = line.slice(3).split(",").map(Number);
      if (!(count > 0)) continue;
      set.add(`${source}:${lineNumber}`);
      moduleCount.set(source, (moduleCount.get(source) ?? 0) + 1);
    }
  } catch (e) {
    console.error(`missing coverage for ${dir}: ${e.code ?? e.message}`);
  }
  reach.set(rel, { set, moduleCount });
}

function inter(a, b) {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let n = 0;
  for (const k of small) if (big.has(k)) n++;
  return n;
}

function subjectsOf(moduleCount, total) {
  const picked = [];
  let seen = 0;
  for (const [name, count] of [...moduleCount.entries()].sort((a, b) => b[1] - a[1])) {
    picked.push(name);
    seen += count;
    if (seen >= total * 0.5) break;
  }
  return picked;
}

async function textOf(relFile) {
  try {
    return await Bun.file(path.join(repo, relFile)).text();
  } catch {
    return null;
  }
}

async function flagsOf(relFile) {
  const text = await textOf(relFile);
  if (text === null) return ["unread"];
  return FLAG_RULES.values()
    .filter(([, rule]) => rule.test(text))
    .map(([name]) => name)
    .toArray();
}

const names = [...reach.keys()];
for (const f of names) {
  const { set, moduleCount } = reach.get(f);
  rows.push({
    file: f,
    set,
    reach: set.size,
    subjects: subjectsOf(moduleCount, set.size),
    flags: [],
    wide: false,
  });
}
for (const row of rows) row.flags = await flagsOf(row.file);
if (invalid.size > 0) {
  for (const r of rows) if (invalid.has(r.file)) r.flags.push("invalid-run");
}

for (const { set } of rows) for (const key of set) owners.set(key, (owners.get(key) ?? 0) + 1);

for (const r of rows) {
  r.unique = [...r.set].filter((k) => owners.get(k) === 1).length;
  r.ms = Math.round(meta.get(r.file)?.ms ?? 0);
  r.tests = meta.get(r.file)?.tests ?? null;
  r.wide = r.reach > WIDE_REACH || r.subjects.length > WIDE_SUBJECTS;
}

for (const r of rows) {
  r.maxCov = 0;
  r.maxCovBy = "";
  for (const g of rows) {
    if (g === r) continue;
    const coverOfR = inter(r.set, g.set) / r.reach;
    if (coverOfR > r.maxCov) {
      r.maxCov = coverOfR;
      r.maxCovBy = g.file;
    }
  }
}
rows.sort((a, b) => a.unique - b.unique || b.reach - a.reach);

if (asJson) {
  console.log(
    JSON.stringify(
      rows.map(({ set, ...rest }) => rest),
      null,
      2,
    ),
  );
} else {
  console.log(
    [
      "file".padEnd(44),
      "reach".padStart(6),
      "uniq".padStart(5),
      "tests".padStart(6),
      "flags".padStart(24),
      "covered mostly by".padStart(44),
      "cov".padStart(5),
    ].join(" "),
  );
  for (const r of rows) {
    console.log(
      [
        r.file.padEnd(44),
        String(r.reach).padStart(6),
        String(r.unique).padStart(5),
        String(r.tests ?? "?").padStart(6),
        labelOf(r).padStart(24),
        r.maxCovBy,
        r.maxCov.toFixed(2).padStart(5),
      ].join(" "),
    );
  }
}

function labelOf(r) {
  return [...r.flags, ...(r.wide ? ["wide"] : [])].join(",") || "-";
}

function isHeldOut(r) {
  return r.flags.length > 0 || r.wide;
}

// Absorption is planned directly, never transitively: each held-in suite goes to the ONE peer
// that contains most of it, so chains of weak overlaps cannot fuse the whole tree into one
// fake cluster. A suite whose only container is itself flagged lands on the refused list,
// because consolidating into an unreadable survivor would move the problem, not remove it.
function planAbsorptions() {
  const accepted = new Map();
  const refused = [];
  for (const r of rows) {
    if (isHeldOut(r) || r.reach < 10) continue;
    let bestAny = null;
    let bestEligible = null;
    for (const g of rows) {
      // Strictly-larger container, with a name tie-break at equal reach, so two suites of the
      // same size can never propose each other as survivors.
      const ranksHigher = g.reach > r.reach || (g.reach === r.reach && g.file > r.file);
      if (!ranksHigher) continue;
      const containment = inter(r.set, g.set) / r.reach;
      if (containment < CONTAINMENT) continue;
      if (!bestAny || containment > bestAny.containment) bestAny = { survivor: g.file, containment };
      if (!isHeldOut(g) && (!bestEligible || containment > bestEligible.containment)) {
        bestEligible = { survivor: g.file, containment };
      }
    }
    if (bestEligible) accepted.set(r.file, bestEligible);
    else if (bestAny) {
      refused.push({ file: r.file, into: bestAny.survivor, containment: bestAny.containment });
    }
  }
  return { accepted, refused };
}

function resolveSurvivors(accepted) {
  // No suite may appear as both survivor and absorbed. Chains (A->B, B->C) collapse so every
  // absorption names a final survivor.
  const absorbed = new Set(accepted.keys());
  let changed = true;
  while (changed) {
    changed = false;
    // A snapshot: the body deletes and re-adds entries, which a live Map iterator would revisit.
    for (const [cand, plan] of accepted.entries().toArray()) {
      if (absorbed.has(plan.survivor)) {
        const next = accepted.get(plan.survivor);
        accepted.delete(cand);
        accepted.set(cand, { survivor: next.survivor, containment: plan.containment });
        changed = true;
      }
    }
  }
  return accepted;
}

async function main() {
  const { accepted: rawAccepted, refused } = planAbsorptions();
  const accepted = resolveSurvivors(rawAccepted);

  const bySurvivor = new Map();
  for (const [absorbed, plan] of accepted) {
    if (!bySurvivor.has(plan.survivor)) bySurvivor.set(plan.survivor, []);
    bySurvivor.get(plan.survivor).push(absorbed);
  }

  const plans = [];
  for (const [survivor, absorbedList] of bySurvivor) {
    let savedLines = 0;
    for (const f of absorbedList) {
      const text = await textOf(f);
      savedLines += text === null ? 0 : Math.max(0, text.split("\n").length - OVERHEAD_LINES);
    }
    plans.push({
      survivor,
      subjects: rows.find((r) => r.file === survivor)?.subjects ?? [],
      details: absorbedList.map((f) => ({
        file: f,
        lines: rows.find((r) => r.file === f)?.reach ?? 0,
      })),
      savedLines,
    });
  }
  plans.sort((a, b) => b.savedLines - a.savedLines);

  console.error(
    `\nmerge queue (${plans.length} groups, containment >= ${CONTAINMENT}); saving = absorbed real lines - ${OVERHEAD_LINES}/suite:`,
  );
  for (const p of plans) {
    console.error(`  -> keep ${p.survivor} [${p.subjects.join(", ")}]`);
    for (const d of p.details) console.error(`     absorb ~${d.lines} lines  ${d.file}`);
    console.error(`     est. saving ~${p.savedLines} real lines`);
  }

  console.error(`\nrefused (only container is itself flagged/wide): ${refused.length}`);
  for (const r of refused.slice(0, 15)) {
    console.error(`  ${r.file} -> ${r.into} (${r.containment.toFixed(2)})`);
  }

  const review = rows.filter(
    (r) => isHeldOut(r) && r.reach >= 10 && (r.maxCov >= REVIEW_CONTAINMENT || r.unique === 0),
  );
  review.sort((a, b) => b.maxCov - a.maxCov);
  console.error(
    `\nread-first review (${review.length} flagged/wide suites that are subsumed or mostly contained — reading decides):`,
  );
  for (const r of review.slice(0, 25)) {
    console.error(`  ${r.file} -> ${r.maxCovBy} (${r.maxCov.toFixed(2)})`);
  }

  const subsumed = rows.filter((r) => !isHeldOut(r) && r.reach > 0 && r.unique === 0);
  const blind = rows.filter(isHeldOut);
  console.error(`\nsubsumed, unflagged (send to mutation adjudication): ${subsumed.length}`);
  console.error(`  ${subsumed.map((r) => r.file).join("\n  ") || "(none)"}`);
  console.error(`\ncoverage-blind or wide (judge by reading, never by these numbers): ${blind.length}`);
  console.error(
    `  ${blind.map((r) => `${r.file}[${labelOf(r)}${r.unique === 0 ? ",subsumed" : ""}]`).join("\n  ") || "(none)"}`,
  );
}

await main();
