/**
 * Scores the implicit-state detectors of a lint worktree against the labelled corpus.
 *
 *   bun tools/oxlint/eval/score.ts --detectors <lint worktree> [--corpus <file>]…
 *     [--repo <name>=<clone>]… [--tree <repo>@<commit>]… [--cache <dir>] [--sweep] [--unlabelled <n>] [--hits <file>] [--items]
 *
 * The corpus is every `--corpus` file read as one, by default `CORPORA`. A foreign repository with no `--repo` is cloned from
 * `foreign.json`, whose heads are scored with the corpus's trees.
 *
 * Every tree the corpus names (and each `--tree`) is materialised once under the cache and every
 * rule and scan runs over it at its permissive setting; hits are cached by the tree and the
 * detectors' bytes. It prints, per rule and per repository group, recall on the rule's own classes,
 * the labelled negatives it hit, its precision over labelled hits and its unlabelled hits (at most
 * `--unlabelled` of them listed, to adjudicate); per class, how many positives any rule caught and
 * which none did; and with `--sweep`, each threshold's recall and precision and the recommended
 * setting. `--hits` writes every hit as JSON Lines for adjudication, and `--items` lists each item with the
 * rules that hit it. `anabasis` defaults to the repository the command runs in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { sha256 } from "#src/meta/digest.ts";
import { gitText } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import {
  ANY_LITERALS,
  CORPORA,
  type Item,
  type RuleScore,
  type TreeHits,
  type TreeKey,
  parseCorpus,
  precisionOf,
  recallOf,
  recommended,
  rulesOn,
  scoreClasses,
  scoreRules,
  sweep,
  treeName,
  treesOf,
} from "./corpus.ts";
import { detectorFiles, type Hit, NAMES, ruleHits, scanHits, STATE_LITERALS, tierOf } from "./detect.ts";
import { clonedRepo, foreignRepos, fullCommit, treeOf } from "./trees.ts";

/** The precision a rule's recommended threshold must reach, by tier. */
const FLOORS = { generic: 0.8, opinionated: 0.5 } as const;
/** The two literal-grouping kinds, scored together as `ANY_LITERALS` too. */
const LITERAL_KINDS = new Set([STATE_LITERALS, "tree/no-scattered-enum-literals"]);
/** The width of a rule or class column: the longest id, `implicit-state-opinionated/max-boolean-fields`. */
const ID_WIDTH = 46;

/** Every detector file, by its bytes, so an edit in the lint worktree re-runs. */
function detectorDigest(detectors: string): string {
  return sha256(
    detectorFiles(detectors)
      .map((path) => `${path}\n${readFileSync(join(detectors, path), "utf8")}`)
      .join("\n"),
  ).slice(0, 16);
}

function hitsOfCache(text: string): Hit[] {
  const rows = capturedJsonParse(text);
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (
      !isRecord(row) ||
      !isString(row.rule) ||
      !isString(row.file) ||
      !isNumber(row.line) ||
      !isString(row.message)
    ) {
      return [];
    }
    const places = (Array.isArray(row.places) ? row.places : []).flatMap((one) =>
      isRecord(one) && isString(one.file) && isNumber(one.line) ? [{ file: one.file, line: one.line }] : [],
    );
    const strength = isNumber(row.strength) || isString(row.strength) ? row.strength : null;
    const tier = row.tier === "opinionated" ? "opinionated" : "generic";
    return [{ rule: row.rule, tier, file: row.file, line: row.line, places, message: row.message, strength }];
  });
}

/** One tree's hits, from the cache or by running every detector over it. */
async function hitsOf(
  key: TreeKey,
  repos: ReadonlyMap<string, string>,
  cache: string,
  detectors: string,
): Promise<TreeHits> {
  const tree = treeOf(key, repos, cache);
  const file = join(cache, "hits", `${sha256(tree.root).slice(0, 16)}-${detectorDigest(detectors)}.json`);
  if (existsSync(file)) return { key, hits: hitsOfCache(readFileSync(file, "utf8")), edited: tree.edited };
  const hits = [
    ...ruleHits(detectors, tree.root, join(cache, "hits")),
    ...(await scanHits(detectors, tree.root)),
  ];
  writeFileSync(file, capturedJsonStringify(hits));
  return { key, hits, edited: tree.edited };
}

/**
 * The tree with each literal-grouping hit also counted under `ANY_LITERALS`, the scan's output
 * before it sets enumerations apart from state, so both sides of that split are scored.
 */
const withUnfiltered = (tree: TreeHits): TreeHits => ({
  ...tree,
  hits: [
    ...tree.hits,
    ...tree.hits.flatMap((hit) => (LITERAL_KINDS.has(hit.rule) ? [{ ...hit, rule: ANY_LITERALS }] : [])),
  ],
});

const percent = (value: number | null): string =>
  value === null ? "  -  " : `${(value * 100).toFixed(0).padStart(3)}%`;
const groupOf = (key: TreeKey): string => (key.mutant === undefined ? key.repo : "synthetic");

function ruleLine(score: RuleScore): string {
  const cells = [
    score.rule.padEnd(ID_WIDTH),
    `recall ${percent(recallOf(score))} (${String(score.caught)}/${String(score.positives)})`,
    `other-class ${String(score.caughtOther).padStart(2)}`,
    `negatives hit ${String(score.negativesHit).padStart(2)}`,
    `precision ${percent(precisionOf(score))} (${String(score.truePositiveHits)}/${String(score.truePositiveHits + score.falsePositiveHits)})`,
    `unlabelled ${String(score.unlabelled.length)}`,
  ];
  return `  ${cells.join("  ")}`;
}

function ruleTables(items: readonly Item[], trees: readonly TreeHits[], shown: number): string[] {
  const groups = [...new Set(trees.map((tree) => groupOf(tree.key)))].toSorted();
  return groups.flatMap((group) => {
    const scores = scoreRules(
      items,
      trees.filter((tree) => groupOf(tree.key) === group),
    );
    const rows = [...scores.values()].toSorted((a, b) => a.rule.localeCompare(b.rule));
    return [
      "",
      `Rules on ${group}:`,
      ...rows.map(ruleLine),
      ...rows.flatMap((score) =>
        score.unlabelled.length === 0
          ? []
          : [
              `  unlabelled ${score.rule} on ${group} (${String(Math.min(shown, score.unlabelled.length))} of ${String(score.unlabelled.length)}):`,
              ...score.unlabelled
                .slice(0, shown)
                .map((hit) => `    ${hit.file}:${String(hit.line)}  ${hit.message.slice(0, 150)}`),
            ],
      ),
    ];
  });
}

/** Per repository group, each class's recall by any rule; then every positive no rule catches. */
function classTable(items: readonly Item[], trees: readonly TreeHits[]): string[] {
  const groups = [...new Set(trees.map((tree) => groupOf(tree.key)))].toSorted();
  const rows = [...scoreClasses(items, trees)].filter(([, row]) => row.positives > 0);
  return [
    ...groups.flatMap((group) => [
      "",
      `Classes on ${group} (any rule):`,
      ...[
        ...scoreClasses(
          items,
          trees.filter((tree) => groupOf(tree.key) === group),
        ),
      ]
        .filter(([, row]) => row.positives > 0)
        .map(
          ([klass, row]) =>
            `  ${klass.padEnd(ID_WIDTH)} caught ${String(row.caught).padStart(3)} of ${String(row.positives).padStart(3)}  ${percent(row.caught / row.positives)}`,
        ),
    ]),
    "",
    "Positives no rule catches:",
    ...rows.flatMap(([, row]) =>
      row.missed.map(
        (item) => `  ${item.class.padEnd(ID_WIDTH)} ${item.id}  ${item.file}:${String(item.lines[0])}`,
      ),
    ),
  ];
}

function sweepTables(items: readonly Item[], trees: readonly TreeHits[]): string[] {
  return [...new Set(trees.flatMap((tree) => tree.hits.map((hit) => hit.rule)))]
    .toSorted()
    .flatMap((rule) => {
      const rows = sweep(rule, items, trees);
      if (rows.length < 2) return [];
      const floor = FLOORS[tierOf(rule)];
      const best = recommended(rows, floor);
      return [
        "",
        `Sweep of ${rule} (a hit counts at a threshold its strength reaches; floor ${String(floor)}):`,
        ...rows.map(
          ({ at, score }) =>
            `  >= ${String(at).padStart(2)}  recall ${percent(recallOf(score))}  precision ${percent(precisionOf(score))}  hits ${String(score.truePositiveHits + score.falsePositiveHits + score.unlabelled.length)}  unlabelled ${String(score.unlabelled.length)}`,
        ),
        best === null ? "  no threshold reaches the floor" : `  recommended: >= ${String(best.at)}`,
      ];
    });
}

/** Per subject word of `no-state-in-names`, its labelled and unlabelled hits. */
function wordTable(items: readonly Item[], trees: readonly TreeHits[]): string[] {
  const words = new Set(
    trees.flatMap((tree) => tree.hits.filter((hit) => hit.rule === NAMES).map((hit) => String(hit.strength))),
  );
  return words.size === 0
    ? []
    : [
        "",
        `${NAMES} by subject word:`,
        ...[...words].toSorted().map((word) => {
          const score = scoreRules(
            items,
            trees,
            (hit) => hit.rule !== NAMES || String(hit.strength) === word,
          ).get(NAMES);
          return score === undefined
            ? ""
            : `  ${word.padEnd(8)} true ${String(score.truePositiveHits)}  false ${String(score.falsePositiveHits)}  unlabelled ${String(score.unlabelled.length)}`;
        }),
      ];
}

/** Each labelled item with the rules that hit it, for reading a table's counts back to sites. */
function itemTable(items: readonly Item[], trees: readonly TreeHits[]): string[] {
  return [
    "",
    "Items and the rules that hit them:",
    ...items.flatMap((item) => {
      const tree = trees.find((one) => treeName(one.key) === treeName(item));
      const rules = tree === undefined ? [] : rulesOn(item, tree);
      return [
        `  ${item.label === "positive" ? "+" : "-"} ${item.class.padEnd(ID_WIDTH)} ${item.id.padEnd(36)} ${rules.join(", ") || "none"}`,
      ];
    }),
  ];
}

function treeKeyOf(spec: string): TreeKey {
  const [repo = "", commit = ""] = spec.split("@");
  if (repo === "" || commit === "") throw new Error(`--tree takes <repo>@<commit>, not ${spec}`);
  return { repo, commit };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      detectors: { type: "string" },
      corpus: { type: "string", multiple: true },
      repo: { type: "string", multiple: true },
      tree: { type: "string", multiple: true },
      cache: { type: "string" },
      sweep: { type: "boolean" },
      unlabelled: { type: "string" },
      hits: { type: "string" },
      items: { type: "boolean" },
    },
  });
  if (values.detectors === undefined) throw new Error("score.ts needs --detectors");
  const detectors = resolve(values.detectors);
  const corpora = values.corpus ?? CORPORA;
  const cache = resolve(values.cache ?? join(tmpdir(), "ana-implicit-state-eval"));
  mkdirSync(join(cache, "hits"), { recursive: true });
  const repos = new Map([["anabasis", gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel")]]);
  for (const spec of values.repo ?? []) {
    const [name = "", path = ""] = spec.split("=");
    repos.set(name, resolve(path));
  }
  const foreign = foreignRepos();
  for (const one of foreign) if (!repos.has(one.name)) repos.set(one.name, clonedRepo(one, cache));
  const text = corpora.map((file) => readFileSync(resolve(file), "utf8")).join("\n");
  const items = parseCorpus(text).map((item) => ({
    ...item,
    commit: fullCommit(repos.get(item.repo) ?? "", item.commit),
  }));
  const keys = [
    ...treesOf(items),
    ...foreign.map(({ name, head }) => ({ repo: name, commit: head })),
    ...(values.tree ?? []).map(treeKeyOf),
  ];
  const unique = [
    ...new Map(
      keys.map((key) => [
        treeName({ ...key, commit: fullCommit(repos.get(key.repo) ?? "", key.commit) }),
        key,
      ]),
    ).values(),
  ];
  const trees: TreeHits[] = [];
  for (const key of unique) {
    const full = { ...key, commit: fullCommit(repos.get(key.repo) ?? "", key.commit) };
    trees.push(withUnfiltered(await hitsOf(full, repos, cache, detectors)));
  }
  if (values.hits !== undefined) {
    const rows = trees.flatMap((tree) =>
      tree.hits.map((hit) =>
        capturedJsonStringify({
          tree: treeName(tree.key),
          repo: tree.key.repo,
          commit: tree.key.commit,
          ...hit,
        }),
      ),
    );
    writeFileSync(values.hits, `${rows.join("\n")}\n`);
  }
  const shown = Number(values.unlabelled ?? "15");
  const lines = [
    `${String(items.length)} items over ${String(trees.length)} trees; detectors ${detectorDigest(detectors)} from ${detectors}`,
    ...ruleTables(items, trees, shown),
    ...classTable(items, trees),
    ...(values.sweep === true ? [...sweepTables(items, trees), ...wordTable(items, trees)] : []),
    ...(values.items === true ? itemTable(items, trees) : []),
  ];
  await Bun.write(Bun.stdout, `${lines.join("\n")}\n`);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    runtimeProcess.exitCode = 1;
    return Bun.write(Bun.stderr, `${errorMessage(error)}\n`);
  });
}
