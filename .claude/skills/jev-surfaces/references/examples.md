# Runnable examples

Five Bun scripts, copied here from the files that were run. Put them in one scratch directory,
never in the tree: the client imports nothing from `src`, so it runs anywhere Bun 1.4.2 does.
They were proved on 2026-09-28 against a local fake of `/v1/systemone` that answers in the
documented shapes, and all five typecheck under `--strict`. That run proves the requests, the
caching and the parsing. It says nothing about Jev's answers, because the fake's answers are
hashes. The retry branch for `429` and `5xx` was not exercised. Before the first live call,
set `TYPESAFE_API_KEY`, and have the operator's go-ahead for the data class the state carries
(see `jev-contract.md`). `JEV_URL` points the client somewhere else, which is how the fake was
used, and `JEV_MODEL` overrides the pinned `jev-1.13.0`.

## The client

`ask` is one request. `askAll` runs many records eight at a time, caches every answer by the
bytes of its request, and so replays a rerun for nothing. `wilson` copies
`wilsonInterval` from `src/claim/estimation.ts`, because a scratch script cannot import the
repository's `#src` alias. Inside a worktree, import the original instead.

```ts
// jev.ts: a dependency-free Jev client for Bun. Copy into the scratchpad; nothing in src imports it.
type Criteria = string | Record<string, unknown> | unknown[] | null;
export type Question =
  | { type: "noul"; instructions: Criteria; criteria?: { true?: Criteria; false?: Criteria } }
  | { type: "choice"; instructions: Criteria; criteria: Record<string, Criteria> }
  | { type: "score"; instructions: Criteria; criteria: Criteria[] };
export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: "score";
      score: number;
      probabilities: Record<string, number>;
      legend: Record<string, string>;
      confidence: number;
    };
export interface JevResult {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

const URL_ = Bun.env.JEV_URL ?? "https://api.typesafe.ai/v1/systemone";
export const MODEL = Bun.env.JEV_MODEL ?? "jev-1.13.0"; // pin: an alias moves under a tuned threshold

/** One request: every question sees the same state. Retries 429/5xx with retry-after or backoff. */
export async function ask(state: unknown, questions: Record<string, Question>, attempt = 0): Promise<JevResult> {
  const key = Bun.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");
  const response = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const wait = Number(response.headers.get("retry-after") ?? 2 ** attempt);
    await Bun.sleep(wait * 1000);
    return ask(state, questions, attempt + 1);
  }
  if (!response.ok) throw new Error(`jev ${response.status}: ${await response.text()}`);
  return (await response.json()) as JevResult;
}

/** Many records, eight in flight, answers cached by request bytes so a rerun costs nothing. */
export async function askAll<T>(
  records: readonly T[],
  build: (record: T) => { state: unknown; questions: Record<string, Question> },
  cachePath: string,
): Promise<JevResult[]> {
  const file = Bun.file(cachePath);
  const cache: Record<string, JevResult> = (await file.exists()) ? await file.json() : {};
  const results: JevResult[] = Array.from({ length: records.length });
  let next = 0;
  const worker = async () => {
    while (next < records.length) {
      const index = next++;
      const request = build(records[index]);
      const key = Bun.hash(JSON.stringify([MODEL, request])).toString(16);
      cache[key] ??= await ask(request.state, request.questions);
      results[index] = cache[key];
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  await Bun.write(cachePath, JSON.stringify(cache));
  return results;
}

export const noul = (r: JevResult, id: string) => (r.answers[id] as { noul: number }).noul;
export const choiceOf = (r: JevResult, id: string) =>
  r.answers[id] as { choice: string; probabilities: Record<string, number>; confidence: number };
export const scoreOf = (r: JevResult, id: string) =>
  r.answers[id] as { score: number; probabilities: Record<string, number>; confidence: number };

/** Wilson interval at 95%: a scratch copy of wilsonInterval (src/claim/estimation.ts); import that inside a worktree. */
export function wilson(successes: number, n: number, z = 1.959963984540054) {
  if (n === 0) return { point: null, low: null, high: null };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { point: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Area under the ROC curve: how well a probability ranks yes above no. 0.5 is a coin. */
export function auc(scores: readonly number[], labels: readonly boolean[]) {
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return pos.length && neg.length ? wins / (pos.length * neg.length) : null;
}
```

## A shadow judge for simplify-precision

This is surface 1 on the map. It reads the sites that `precision.mts replay` wrote and the
judge's verdicts in `labels.tsv`, and asks Jev the same question the judge was asked, with the
finding and the lines at the site as state. It then reports, per shape, the AUC of Jev's
probability against the judge's verdict, and the precision of Jev's yes with its Wilson
interval, which is the figure the census is already held to. Three shapes are wired in. Add
the rest from `QUESTIONS` in `precision.mts` verbatim, because a reworded question is a
different experiment.

```sh
bun .claude/skills/simplify-precision/scripts/precision.mts replay --repo "$PWD" --out <S>/sites.jsonl --every 40 --since 2026-08-01
bun <S>/shadow-judge.ts <S>/sites.jsonl .claude/skills/simplify-precision/labels.tsv "$PWD"
```

```ts
// shadow-judge.ts: Jev beside the simplify-precision judge, over sites the judge already labelled.
//   bun shadow-judge.ts <sites.jsonl> <labels.tsv> <repo>
import { $ } from "bun";
import { askAll, auc, noul, wilson } from "./jev.ts";

const [sitesPath, labelsPath, repo] = Bun.argv.slice(2);
// The shape questions are precision.mts's QUESTIONS, copied as they stand; a paraphrase is a new condition.
const QUESTIONS: Record<string, string> = {
  "copied-block": "Should these copies get one owner (one function or constant both places call)?",
  "compatibility-path":
    "Is this code a path that reads or accepts what an older version left behind, which could be deleted outright?",
  "unread-field": "Should this field be removed, since nothing reads it?",
};
type Site = { id: string; kind: string; rev: string; detail: string; places: { path: string; line: number; end: number }[] };

const sites = new Map<string, Site>();
for (const line of (await Bun.file(sitesPath).text()).split("\n").filter(Boolean)) {
  const site: Site = JSON.parse(line);
  sites.set(site.id, site);
}
// The latest judge verdict per site; ledger rows are the operator's and stay out of this comparison.
const labels = new Map<string, boolean>();
for (const row of (await Bun.file(labelsPath).text()).split("\n").slice(1).filter(Boolean)) {
  const [id, kind, verdict, source] = row.split("\t");
  if (source.startsWith("judge:") && kind in QUESTIONS && sites.has(id)) labels.set(id, verdict === "yes");
}
const records = [...labels.keys()].map((id) => sites.get(id) as Site);

/** Only the lines the site points at: a whole file is the distractor Jev reads worst. */
async function excerpt(site: Site) {
  const parts = await Promise.all(
    site.places.slice(0, 3).map(async (p) => {
      const text = await $`git -C ${repo} show ${site.rev}:${p.path}`.text();
      const lines = text.split("\n").slice(Math.max(0, p.line - 4), p.end + 3);
      return { path: p.path, from: Math.max(1, p.line - 3), code: lines.join("\n") };
    }),
  );
  return parts;
}
const excerpts = new Map(await Promise.all(records.map(async (s) => [s.id, await excerpt(s)] as const)));

const results = await askAll(
  records,
  (site) => ({
    state: { census_finding: site.detail, code_at_the_site: excerpts.get(site.id) },
    questions: {
      act: {
        type: "noul",
        instructions: QUESTIONS[site.kind],
        criteria: {
          true: "A maintainer of this repository would make exactly this change, as proposed, at this site.",
          false: "The change is wrong here, or only partly right, or the code needs it for a reason the finding misses.",
        },
      },
    },
  }),
  "shadow-judge.cache.json",
);

for (const kind of Object.keys(QUESTIONS)) {
  const idx = records.flatMap((s, i) => (s.kind === kind ? [i] : []));
  const p = idx.map((i) => noul(results[i], "act"));
  const y = idx.map((i) => labels.get(records[i].id) as boolean);
  const said = idx.filter((_, k) => p[k] >= 0.5);
  const agreeYes = said.filter((i) => labels.get(records[i].id)).length;
  const w = wilson(agreeYes, said.length);
  console.log(
    `${kind.padEnd(20)} n=${idx.length} judge-yes=${y.filter(Boolean).length} auc=${auc(p, y)?.toFixed(2) ?? "-"}`,
    `jev-yes=${said.length} of-which-judge-yes=${agreeYes} precision=${w.point?.toFixed(2) ?? "-"} [${w.low?.toFixed(2) ?? "-"}, ${w.high?.toFixed(2) ?? "-"}]`,
  );
}
const tokens = results.reduce((sum, r) => sum + r.usage.input_tokens, 0);
console.log(`input tokens ${tokens}, about $${((tokens / 1e6) * 0.042).toFixed(4)}`);
```

The labels are the judge's own, and the judge's yes understates the operator's. So a Jev that
agrees with the judge perfectly has matched a floor, not the truth. Score the ledger rows
separately as operator no answers, which is how the skill already keeps its judge honest.

## A context rerank

This is surface 6. The lexical pass stays in code, as `cite` has it, and serves as a recall
filter over up to 60 lines. One request then asks a four-level Score per line against the
question and the decision it settles, plus one Noul asking whether anything bears on the
decision at all. That last question matters: `cite` always returns its top lines, even when
none of them helps.

```sh
bun <S>/context-rerank.ts "which tool reports every margin a check reads" \
  "whether the solver tool is an answer shortcut" AGENTS.md
```

```ts
// context-rerank.ts: the context tool's word-overlap ranking beside a Jev rerank of the same lines.
//   bun context-rerank.ts <question> <decides> <file>...
import { ask, noul, scoreOf } from "./jev.ts";

const [question, decides, ...files] = Bun.argv.slice(2);
// Stage 1 stays lexical and in code, as cite() does it: any line sharing a content word of three
// or more letters. It is a recall filter here, so one shared word is enough.
const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [])];
const lines: { id: string; text: string; overlap: number }[] = [];
for (const file of files) {
  (await Bun.file(file).text()).split("\n").forEach((text, i) => {
    const overlap = terms.filter((t) => text.toLowerCase().includes(t)).length;
    if (overlap > 0 && text.trim().length > 0) lines.push({ id: `${file}:${i + 1}`, text: text.trim().slice(0, 300), overlap });
  });
}
const shortlist = lines.toSorted((a, b) => b.overlap - a.overlap).slice(0, 60);

// Stage 2: one request, one Score per shortlisted line plus one Noul over the whole shortlist.
// Every question sees the same state, so sixty questions cost about what one does.
const state = { question, decision_it_settles: decides, lines: Object.fromEntries(shortlist.map((l, i) => [`L${i}`, l.text])) };
const questions = Object.fromEntries([
  ...shortlist.map((_, i) => [
    `L${i}`,
    {
      type: "score" as const,
      instructions: `How much does line \`lines.L${i}\` help settle \`decision_it_settles\` for \`question\`?`,
      criteria: [
        "Unrelated: shares words with the question but says nothing about the decision",
        "Background: about the same subject, but would not change the decision",
        "Bears on it: a fact the decision should weigh",
        "Settles it: states the fact or rule the decision turns on",
      ],
    },
  ]),
  ["answerable", { type: "noul" as const, instructions: "Does any line in `lines` state a fact that bears on `decision_it_settles`?" }],
]);
const result = await ask(state, questions);

const ranked = shortlist
  .map((line, i) => ({ ...line, jev: scoreOf(result, `L${i}`).score }))
  .toSorted((a, b) => b.jev - a.jev);
console.log(`answerable ${noul(result, "answerable").toFixed(2)}  (${shortlist.length} lines, ${result.usage.input_tokens} tokens)`);
for (const line of ranked.slice(0, 10)) console.log(`${line.jev.toFixed(2)}  overlap=${line.overlap}  ${line.id}  ${line.text.slice(0, 100)}`);
```

Run against the fake server over `AGENTS.md`, it shortlisted 60 lines into one request of about
30,000 characters. The fake's token count is not Jev's tokenizer, but at four characters a token
that is roughly 7,500 input tokens, or about three hundredths of a cent at the listed price.

## The feature-discovery loop

This is surface 5, and it is TypeSafe's autoresearch cookbook with the running agent as the
proposer. First build the records, one row per submit, from the posture classifier's join:

```ts
// records-from-posture.ts: submit prose → records.jsonl for discover.ts, one row per submit.
//   bun .claude/skills/whole-run-investigation/classifier/prose-classify.ts <campaign-dir> --json > posture.json   (from the checkout, once per campaign)
//   bun records-from-posture.ts <campaign-name> posture.json >> records.jsonl
const [group, path] = Bun.argv.slice(2);
const posture = await Bun.file(path).json();
for (const submit of posture.submits as { epoch: string; session: number; turn: number; outcome: string; recent: { excerpt?: string }[] }[]) {
  const text = submit.recent.flatMap((row) => (row.excerpt ? [row.excerpt] : [])).join("\n");
  if (text.length === 0) continue; // a submit with no prose before it has nothing to ask about
  const id = `${group}/${submit.epoch}/s${submit.session}/t${submit.turn}`;
  console.log(JSON.stringify({ id, group, text, label: submit.outcome === "accepted" }));
}
```

Then write a first `questions.json` without looking at any outcome. It is a list of
`{name, kind: "presence" | "intensity", question}`. A presence question is a Noul and an
intensity question is a five-level Score, whose levels are the cookbook's. Run one round:

```sh
bun <S>/discover.ts records.jsonl questions.json   # writes report.md
```

```ts
// discover.ts: one round of the autoresearch loop. You are the proposer: edit questions.json, run
// this, read report.md, and edit again. Jev answers; code fits and judges.
//   bun discover.ts <records.jsonl> <questions.json>
// records.jsonl rows: {"id","group","text","label":true|false}. group keeps one campaign's rows in one fold.
import { askAll, auc } from "./jev.ts";

type Rec = { id: string; group: string; text: string; label: boolean };
type Feature = { name: string; kind: "presence" | "intensity"; question: string };
const [recordsPath, questionsPath] = Bun.argv.slice(2);
const records: Rec[] = (await Bun.file(recordsPath).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const features: Feature[] = await Bun.file(questionsPath).json();

const LEVELS = [
  "Not present in this text at all",
  "Barely present: mentioned once, in passing",
  "Present at a moderate level",
  "Present strongly: the text dwells on it",
  "Dominant: the text is largely about this",
];
const PRESENCE = { true: "The text states this or clearly implies it", false: "The text gives no indication of this" };

// One request per record per feature set; the cache is keyed by request bytes, so adding a
// question re-asks every record once and an unchanged set replays for free.
const answers = await askAll(
  records,
  (r) => ({
    state: r.text,
    questions: Object.fromEntries(
      features.map((f) => [
        f.name,
        f.kind === "presence"
          ? { type: "noul" as const, instructions: f.question, criteria: PRESENCE }
          : { type: "score" as const, instructions: f.question, criteria: LEVELS },
      ]),
    ),
  }),
  "discover.cache.json",
);
const column = (f: Feature) =>
  answers.map((a) => {
    const got = a.answers[f.name];
    return got.type === "noul" ? got.noul : got.type === "score" ? got.score / (LEVELS.length - 1) : 0;
  });
const X = features.map(column);
const y = records.map((r) => (r.label ? 1 : 0));

/** L2 logistic regression by gradient descent: small, dependency-free, and enough for tens of columns. */
function fit(cols: number[][], rows: number[]) {
  const w = new Array(cols.length).fill(0);
  let b = 0;
  for (let step = 0; step < 2000; step++) {
    const gw = new Array(cols.length).fill(0);
    let gb = 0;
    for (const i of rows) {
      const p = 1 / (1 + Math.exp(-(b + cols.reduce((s, c, j) => s + w[j] * c[i], 0))));
      gb += p - y[i];
      cols.forEach((c, j) => (gw[j] += (p - y[i]) * c[i]));
    }
    b -= (0.5 * gb) / rows.length;
    cols.forEach((_, j) => (w[j] -= 0.5 * (gw[j] / rows.length + 0.01 * w[j])));
  }
  return (i: number) => 1 / (1 + Math.exp(-(b + cols.reduce((s, c, j) => s + w[j] * c[i], 0))));
}
/** Out-of-fold predictions, folds by group, so a campaign never predicts itself. */
function outOfFold(cols: number[][], k = 5) {
  const groups = [...new Set(records.map((r) => r.group))];
  const pred = new Array(records.length).fill(0);
  for (let f = 0; f < k; f++) {
    const held = new Set(groups.filter((_, g) => g % k === f));
    const train = records.flatMap((r, i) => (held.has(r.group) ? [] : [i]));
    if (train.length === 0) continue;
    const model = fit(cols, train);
    records.forEach((r, i) => held.has(r.group) && (pred[i] = model(i)));
  }
  return pred;
}
const logLoss = (p: number[]) =>
  -p.reduce((s, q, i) => s + (y[i] ? Math.log(Math.max(q, 1e-9)) : Math.log(Math.max(1 - q, 1e-9))), 0) / p.length;

const base = outOfFold([]); // the base rate alone: what every feature has to beat
const full = outOfFold(X);
const lines = [
  `# Round report: ${records.length} records, ${new Set(records.map((r) => r.group)).size} groups, ${y.filter(Boolean).length} positive`,
  "",
  `base rate: log-loss ${logLoss(base).toFixed(3)}`,
  `all ${features.length} questions: log-loss ${logLoss(full).toFixed(3)}, AUC ${auc(full, y.map(Boolean))?.toFixed(3)}`,
  "",
  "## What each question is worth (log-loss rise when it is dropped; negative means it hurts)",
];
for (const [j, f] of features.entries()) {
  const without = outOfFold(X.filter((_, k) => k !== j));
  lines.push(`- ${f.name} (${f.kind}): ${(logLoss(without) - logLoss(full)).toFixed(4)}  ${f.question}`);
}
lines.push("", "## Worst-predicted records (read these, then add, revise or drop questions)");
const worst = records.map((r, i) => ({ r, miss: Math.abs(y[i] - full[i]), p: full[i] })).toSorted((a, b) => b.miss - a.miss);
for (const { r, p } of worst.slice(0, 12)) lines.push(`- ${r.id} label=${r.label} predicted=${p.toFixed(2)}: ${r.text.slice(0, 280).replaceAll("\n", " ")}`);
await Bun.write("report.md", `${lines.join("\n")}\n`);
console.log(lines.slice(0, 4).join("\n"));
```

Read `report.md`. It gives the base rate's log-loss, the full set's log-loss and AUC out of
fold, what each question is worth when dropped, and the twelve worst-predicted records with
their text. Then edit `questions.json`. Add a question for a pattern the misses share, reword
one whose worth is near zero, and drop one whose worth is negative. Run it again, and stop when
a round moves the out-of-fold log-loss by less than its run-to-run spread. The cache means a
rerun asks only the records whose request changed. Keep every round's `questions.json` and
report, because the first round's figure is the one the cookbook found carried most of the
gain.

Questions must be about the text, never about the outcome. "Does the author say the preview
was clear?" is a feature. "Will this submit be accepted?" asks Jev for the label, and it teaches
the fit nothing about why.
