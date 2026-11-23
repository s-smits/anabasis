/**
 * Ranks WRI lanes in `.claude/skills/whole-run-investigation/references/lanes.md` by descending
 * `Importance:` (ties broken by `standing` first, then current order), renumbering every lane
 * reference, table cell, and trigger entry in `tools/wri/folds.ts` in one pass.
 *
 *   bun tools/wri/rank-lanes.ts           # rewrite lanes.md and tools/wri/folds.ts in rank order
 *   bun tools/wri/rank-lanes.ts --check   # exit 1 when lanes.md or TRIGGERS drifts from rank order
 */
import { readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { type Lane, lanesOf, REFERENCES } from "./catalogue.ts";

/** Result of ranking `lanes.md` and `tools/wri/folds.ts` by importance. */
interface RankedCatalogue {
  readonly ranked: readonly (Lane & { readonly oldNumber: number })[];
  readonly remap: ReadonlyMap<number, number>;
  readonly lanesMarkdown: string;
  readonly foldsSource: string;
  readonly changed: boolean;
}

const REPO = resolve(import.meta.dir, "..", "..");
const LANES_FILE = join(REFERENCES, "lanes.md");
const FOLDS_FILE = join(REPO, "tools", "wri", "folds.ts");
const TIERS: readonly (readonly [number, string])[] = [
  [0.9, "### Tier 1: Core pillars (0.90–1.00)"],
  [0.65, "### Tier 2: Major structural owners (0.65–0.75)"],
  [0.35, "### Tier 3: Focused diagnostics (0.35–0.50)"],
  [0, "### Tier 4: Lightweight and conditional (0.10–0.25)"],
];
const TRIGGERS_BLOCK = /export const TRIGGERS = \{[\s\S]*?\} as const;/u;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const CONJUNCTION = new Intl.ListFormat("en", { type: "conjunction" });

/** Formats a sorted list of numbers as plain English (`1, 2, and 3` or `4`). */
function listNumbers(numbers: readonly number[]): string {
  const sorted = numbers.toSorted((one, other) => one - other).map(String);
  return sorted.length === 0 ? "none" : CONJUNCTION.format(sorted);
}

/** Remaps inline `lane N`, `lanes N and M`, and `(lane N)` tokens in a single non-colliding pass. */
function remapProse(text: string, remap: ReadonlyMap<number, number>): string {
  const lookup = (token: string) => String(remap.get(Number(token)) ?? token);
  return text.replaceAll(
    /\b(lanes?) (\d+)(?: (and|to) (\d+))?\b/giu,
    (_whole, word: string, first: string, joiner?: string, second?: string) => {
      const mappedFirst = lookup(first);
      if (joiner === undefined || second === undefined) return `${word} ${mappedFirst}`;
      return `${word} ${mappedFirst} ${joiner} ${lookup(second)}`;
    },
  );
}

/** Remaps backticked comma-separated lane-number lists in the component table. */
function remapComponentTable(section: string, remap: ReadonlyMap<number, number>): string {
  return section
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|") || !line.includes("`")) return line;
      return line.replace(/\| `(\d+(?:, \d+)*)` \|$/u, (_whole, list: string) => {
        const mapped = list
          .split(", ")
          .map((token) => remap.get(Number(token)) ?? Number(token))
          .toSorted((one, other) => one - other);
        return `| \`${mapped.join(", ")}\` |`;
      });
    })
    .join("\n");
}

/** Rebuilds the `lanes` column of the `## Labels` table directly from each ranked lane's `label`. */
function remapLabelsTable(section: string, ranked: readonly Lane[]): string {
  const byLabel = new Map<string, number[]>();
  for (const lane of ranked) {
    const bucket = byLabel.get(lane.label) ?? [];
    bucket.push(lane.number);
    byLabel.set(lane.label, bucket);
  }
  return section
    .split("\n")
    .map((line) => {
      const match = /^(\| [a-z]+ \| )([^|]+)( \| `([a-z]+)` \| .*)$/u.exec(line);
      if (match === null) return line;
      const [, prefix = "", current = "", suffix = "", label = ""] = match;
      const owned = byLabel.get(label);
      if (owned === undefined || owned.length === 0) return `${prefix}${current}${suffix}`;
      return `${prefix}${owned.join(", ")}${suffix}`;
    })
    .join("\n");
}

/** Rebuilds the standing / alone / blind / side-by-side summary sentence in `How the catalogue is read`. */
function remapMarksLine(text: string, ranked: readonly Lane[]): string {
  const standing = ranked.filter((lane) => lane.standing).map((lane) => lane.number);
  const isolated = ranked.filter((lane) => lane.isolated).map((lane) => lane.number);
  const blind = ranked.filter((lane) => lane.blind).map((lane) => lane.number);
  const sideBySide = ranked.filter((lane) => lane.sideBySide).map((lane) => lane.number);
  const sentence = [
    `Lanes ${listNumbers(standing)} are \`standing\``,
    `${isolated.length === 1 ? "lane" : "lanes"} ${listNumbers(isolated)} ${isolated.length === 1 ? "runs" : "run"} \`alone\``,
    `${blind.length === 1 ? "lane" : "lanes"} ${listNumbers(blind)} ${blind.length === 1 ? "runs" : "run"} \`blind\` before any other lane in its session`,
    `${sideBySide.length === 1 ? "lane" : "lanes"} ${listNumbers(sideBySide)} ${sideBySide.length === 1 ? "runs" : "run"} \`side-by-side\` across campaigns.`,
  ].join("; ");
  return text.replace(/Lanes [^\n]+ are `standing`;[^\n]+across campaigns\./u, sentence);
}

/** Formats a lane's `Marks:` line canonically from its boolean flags. */
function marksLine(lane: Lane): string {
  const marks = [
    ...(lane.standing ? ["`standing`"] : []),
    ...(lane.isolated ? ["`alone`"] : []),
    ...(lane.blind ? ["`blind`"] : []),
    ...(lane.sideBySide ? ["`side-by-side`"] : []),
  ];
  return `Marks: ${marks.length === 0 ? "none" : marks.join(", ")}.`;
}

/** Renders the `## Lanes 1 to N` section sorted by descending importance under tier headings. */
function renderLanesBody(
  ranked: readonly (Lane & { readonly oldNumber: number })[],
  remap: ReadonlyMap<number, number>,
): string {
  const blocks: string[] = [`## Lanes 1 to ${String(ranked.length)}`];
  let currentTier = "";
  for (const lane of ranked) {
    const tierHeading = TIERS.find(([floor]) => lane.importance >= floor)?.[1] ?? "";
    if (tierHeading !== currentTier) {
      blocks.push("", tierHeading);
      currentTier = tierHeading;
    }
    const body = remapProse(lane.body, remap);
    blocks.push(
      "",
      `**${String(lane.number)}. ${lane.title}.**`,
      "",
      `Label: \`${lane.label}\`.`,
      `Importance: ${String(lane.importance)}.`,
      marksLine(lane),
      "",
      body,
    );
  }
  return `${blocks.join("\n")}\n`;
}

/** Rebuilds the `TRIGGERS` constant in `tools/wri/folds.ts` directly from ranked lanes. */
function renderTriggers(ranked: readonly Lane[]): string {
  const lines = ["export const TRIGGERS = {"];
  for (const lane of ranked) {
    if (lane.triggers.length === 0) continue;
    const tag = lane.isolated ? " (isolated)" : "";
    lines.push(`  // Lane ${String(lane.number)}: ${lane.title}${tag}`);
    for (const trigger of lane.triggers) {
      const key = IDENT.test(trigger) ? trigger : JSON.stringify(trigger);
      lines.push(`  ${key}: ${String(lane.number)},`);
    }
  }
  lines.push("} as const;");
  return lines.join("\n");
}

/** Pure ranker: sorts lanes by descending importance (`standing` breaks ties, then current number),
 *  rewrites `lanes.md` and `tools/wri/folds.ts`, and reports whether either file changed. */
export function rankCatalogue(lanesMarkdown: string, foldsSource: string): RankedCatalogue {
  const parsed = lanesOf(lanesMarkdown);
  const sorted = parsed.toSorted(
    (one, other) =>
      other.importance - one.importance ||
      Number(other.standing) - Number(one.standing) ||
      one.number - other.number,
  );
  const remap = new Map<number, number>(sorted.map((lane, index) => [lane.number, index + 1]));
  const ranked = sorted.map((lane, index) => ({ ...lane, oldNumber: lane.number, number: index + 1 }));
  const marker = /^## Lanes 1 to \d+$/mu.exec(lanesMarkdown);
  if (marker === null) throw new Error("lanes.md is missing its `## Lanes 1 to N` heading");
  const preamble = lanesMarkdown.slice(0, marker.index);
  const rewrittenPreamble = remapMarksLine(
    remapLabelsTable(remapComponentTable(remapProse(preamble, remap), remap), ranked),
    ranked,
  );
  const nextMarkdown = `${rewrittenPreamble}${renderLanesBody(ranked, remap)}`;
  if (!TRIGGERS_BLOCK.test(foldsSource)) {
    throw new Error("tools/wri/folds.ts is missing `export const TRIGGERS = { ... } as const;`");
  }
  const nextFolds = foldsSource.replace(TRIGGERS_BLOCK, () => renderTriggers(ranked));
  return {
    ranked,
    remap,
    lanesMarkdown: nextMarkdown,
    foldsSource: nextFolds,
    changed: nextMarkdown !== lanesMarkdown || nextFolds !== foldsSource,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: runtimeProcess.argv.slice(2),
    options: { check: { type: "boolean", default: false } },
  });
  const currentLanes = readFileSync(LANES_FILE, "utf8");
  const currentFolds = readFileSync(FOLDS_FILE, "utf8");
  const result = rankCatalogue(currentLanes, currentFolds);
  for (const lane of result.ranked) {
    const moved = lane.oldNumber === lane.number ? "   " : `<-${String(lane.oldNumber).padStart(2)}`;
    console.log(
      `${String(lane.number).padStart(2)} (${moved}) | imp=${lane.importance.toFixed(2)} | ${lane.label.padEnd(10)} | ${lane.title}`,
    );
  }
  if (values.check) {
    if (result.changed) {
      console.error(
        "rank-lanes: lanes.md or tools/wri/folds.ts is out of importance rank order; run bun tools/wri/rank-lanes.ts",
      );
      runtimeProcess.exitCode = 1;
    } else {
      console.log("rank-lanes: lanes.md and tools/wri/folds.ts match importance rank order");
    }
  } else if (result.changed) {
    writeFileSync(LANES_FILE, result.lanesMarkdown);
    writeFileSync(FOLDS_FILE, result.foldsSource);
    console.log(`rank-lanes: rewrote ${LANES_FILE} and ${FOLDS_FILE}`);
  } else {
    console.log("rank-lanes: already in importance rank order");
  }
}
