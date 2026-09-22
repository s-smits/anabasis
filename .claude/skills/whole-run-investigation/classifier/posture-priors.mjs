// Calibrate the posture labels against every recorded campaign: for each submit, the dominant
// posture and the last label before it, against its outcome. The refusal rate per posture is
// written to posture-priors.json beside the classifier, bound to the anchor digest, so a later
// run's submit carries "refused 41/58 in corpus" next to its label instead of a bare name.
//   bun posture-priors.mjs [campaigns-root] [--out <file>]
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { ANCHOR_SHA256, CLASSIFIER_SCHEMA, PRIORS_FILE, classifyTarget } from "./prose-classify.mjs";
import { writeJsonFile } from "#src/meta/completed-json.ts";

export const PRIORS_SCHEMA = "builder-posture-priors/v1";

/** Outcome counts per label; only accepted and refused submits enter the rate. */
function outcomeTable(submits, key) {
  const cells = new Map();
  for (const submit of submits) {
    const name = key(submit);
    if (
      name === null ||
      name === undefined ||
      (submit.outcome !== "accepted" && submit.outcome !== "refused")
    ) {
      continue;
    }
    const cell = cells.get(name) ?? { accepted: 0, refused: 0 };
    cell[submit.outcome] += 1;
    cells.set(name, cell);
  }
  return Object.fromEntries(
    [...cells]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, cell]) => [
        name,
        { ...cell, refusedRate: Number((cell.refused / (cell.accepted + cell.refused)).toFixed(3)) },
      ]),
  );
}

function classTable(rows) {
  const cells = new Map();
  for (const row of rows) {
    const cell = cells.get(row.class) ?? { rows: 0, reasoning: 0, message: 0, lowMargin: 0 };
    cell.rows += 1;
    cell[row.kind] += 1;
    if (row.lowMargin) cell.lowMargin += 1;
    cells.set(row.class, cell);
  }
  return Object.fromEntries(
    [...cells]
      .sort(([, a], [, b]) => b.rows - a.rows)
      .map(([name, cell]) => [
        name,
        { ...cell, lowMarginRate: Number((cell.lowMargin / cell.rows).toFixed(3)) },
      ]),
  );
}

/** Classify every campaign under `root` and fold the submits into one priors table. */
export async function buildPriors(root, { classify = classifyTarget, log = () => {} } = {}) {
  const campaigns = readdirSync(root)
    .sort()
    .map((name) => join(root, name))
    .filter((dir) => existsSync(join(dir, "controller")));
  const rows = [];
  const submits = [];
  const states = {};
  for (const campaign of campaigns) {
    const started = Date.now();
    const result = await classify(campaign, { priorsFile: "/nonexistent" });
    states[result.state] = (states[result.state] ?? 0) + 1;
    if (result.state !== "classified") continue;
    rows.push(...result.rows);
    // Each submit keeps the backend its own execution record names; a submit without one enters
    // only the pooled tables, since a campaign can mix backends across runs.
    submits.push(...result.submits);
    log(
      `${campaign}: ${result.rows.length} rows, ${result.submits.length} submits, ${Date.now() - started} ms`,
    );
  }
  const counts = {};
  for (const submit of submits) {
    counts[submit.backend ?? "unknown"] = (counts[submit.backend ?? "unknown"] ?? 0) + 1;
  }
  const byBackend = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  const backends = Object.keys(byBackend).filter((backend) => backend !== "unknown");
  return {
    schema: PRIORS_SCHEMA,
    // Descriptive: the table is bound by the anchor digest below, not by this name, so a
    // classifier release that leaves CLASSES untouched keeps an older file applicable.
    classifierSchema: CLASSIFIER_SCHEMA,
    anchorSha256: ANCHOR_SHA256,
    corpus: {
      generatedAt: new Date().toISOString(),
      campaigns: campaigns.length,
      states,
      byBackend,
      rows: rows.length,
      submits: submits.length,
    },
    byDominant: outcomeTable(submits, (submit) => submit.dominant),
    byLast: outcomeTable(submits, (submit) => submit.recent.at(-1)?.class ?? null),
    byBackend: Object.fromEntries(
      backends.map((backend) => {
        const own = submits.filter((submit) => submit.backend === backend);
        return [
          backend,
          {
            dominant: outcomeTable(own, (submit) => submit.dominant),
            last: outcomeTable(own, (submit) => submit.recent.at(-1)?.class ?? null),
          },
        ];
      }),
    ),
    perClass: classTable(rows),
  };
}

export function renderPriors(priors) {
  const lines = [
    `${priors.corpus.campaigns} campaigns, ${priors.corpus.rows} rows, ${priors.corpus.submits} submits; submits per backend ${JSON.stringify(priors.corpus.byBackend)}`,
  ];
  const tables = [
    ["dominant posture before submit", priors.byDominant],
    ["last label before submit", priors.byLast],
  ];
  for (const [backend, own] of Object.entries(priors.byBackend)) {
    tables.push([`dominant posture before submit, ${backend} sessions`, own.dominant]);
  }
  for (const [title, table] of tables) {
    lines.push("", title);
    for (const [name, cell] of Object.entries(table).sort(([, a], [, b]) => b.refusedRate - a.refusedRate)) {
      lines.push(
        `  ${name}: refused ${cell.refused}/${cell.accepted + cell.refused} (${(cell.refusedRate * 100).toFixed(0)}%)`,
      );
    }
  }
  lines.push("", "rows per class");
  for (const [name, cell] of Object.entries(priors.perClass)) {
    lines.push(
      `  ${name}: ${cell.rows} rows (${cell.reasoning} reasoning, ${cell.message} message), ${(cell.lowMarginRate * 100).toFixed(0)}% low-margin`,
    );
  }
  return lines;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt === -1 ? PRIORS_FILE : args[outAt + 1];
  const root = resolve(
    args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--out") ??
      join(import.meta.dirname, "..", "..", "..", "..", "campaigns"),
  );
  if (out === undefined || !existsSync(root)) {
    console.error("usage: bun posture-priors.mjs [campaigns-root] [--out <file>]");
    runtimeProcess.exitCode = 2;
  } else {
    const priors = await buildPriors(root, { log: (line) => console.error(line) });
    writeJsonFile(out, priors);
    console.log(renderPriors(priors).join("\n"));
    console.log(`\nwritten ${out}`);
  }
}
