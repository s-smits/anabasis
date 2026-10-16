// The Campaign pane, rendered from the readings the server's handlers give of the fixture's
// campaigns (`fixture-campaign.ts`), and so through the repository's folds.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import type { CampaignReading, ComparisonBar } from "../src/models.ts";
import { type Navigation, type RouteChange, routeOf } from "../src/route.ts";
import { CampaignPane } from "../src/views/campaign.tsx";
import { comparisonSlots, countTicks } from "../src/views/campaign-data.ts";
import { answersOver, type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-campaign-")));
let fixture: Fixture;

beforeAll(() => {
  fixture = writeFixtureCampaign(join(scratch, "main"));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function readingOf(name: string): CampaignReading {
  return answersOver(fixture.root, "default").campaign(`main/${name}`);
}

function paneOf(reading: CampaignReading, search = "", moves: RouteChange[] = []): string {
  const navigation: Navigation = {
    route: routeOf(search),
    push: (change) => moves.push(change),
    replace: (change) => moves.push(change),
  };
  return renderToStaticMarkup(<CampaignPane reading={reading} navigation={navigation} />);
}

/** The cells of the screen reader's row for one comparison, as text. */
function rowCells(html: string, id: string): string[] {
  const row = new RegExp(`<tr data-comparison="${id}">(.*?)</tr>`).exec(html)?.[1] ?? "";
  return [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((match) => match[1] ?? "");
}

test("the main campaign renders its line, three readouts, the chart's key, every harness and the counters", () => {
  const reading = readingOf(fixture.name);
  const html = paneOf(reading);
  expect(html).toContain(`<h1>${fixture.name}</h1>`);
  for (const label of ["Reference harness", "Last reading", "Next move", "Comparisons", "Harnesses"]) {
    expect(html).toContain(label);
  }
  expect(html).toContain("Builder session");
  expect(html).toContain("3 promotions, the last back to the starter");
  expect(html.match(/class="ana-harness-select"/g)?.length).toBe(reading.harnesses.length);
  // Each card is named by the log's letter with its digest beneath, the starter as the Starter A.
  const faces = html.match(/<span class="ana-harness-hash">/g)?.length;
  expect(faces).toBe(reading.harnesses.length);
  expect(html).toContain("Starter A");
  expect(html).not.toMatch(/>starter</i);
  // The latest harness is selected where the route names none, and its detail stands under the row.
  expect(html.match(/aria-current="true"/g)?.length).toBe(1);
  expect(html).toContain("Compare with previous");
  for (const mark of [
    "Promotion",
    "Promotion despite the rule",
    "Back to the starter",
    "Setting changed",
    "Control, drawn quieter",
    "Repeat of an earlier comparison",
  ]) {
    expect(html).toContain(`<span>${mark}</span>`);
  }
  const { withoutGain, patience } = reading.counters;
  expect(html).toContain(
    `Moves without a gain <b class="ana-num">${String(withoutGain)} of ${String(patience)}</b>`,
  );
  // v1's two words name nothing a reader sees; the kept chart container's class name is markup.
  expect(html.replaceAll(/<[^>]*>/g, " ")).not.toMatch(/epoch|climb/i);
});

test("the counters say what the attempts under the reference risk, what a promotion billed and how many comparisons are left", () => {
  const reading = readingOf(fixture.units);
  const { risk, runway } = reading.counters;
  const html = paneOf(reading);
  expect(html).toContain(
    `False promotion under this reference at most <b class="ana-num">${String(Math.round(100 * (risk?.union ?? 0) * 10) / 10)}%</b> over ${String(risk?.attempts)} attempts`,
  );
  expect(html.includes("past the table&#x27;s")).toBe(false);
  const affords = Math.floor((runway?.left ?? 0) / (runway?.each ?? 1));
  expect(html).toContain(
    `Comparisons left at the last one&#x27;s price <b class="ana-num">${String(affords)}</b>`,
  );
  const each = reading.promotions.length === 0 ? null : reading.row.billed / reading.promotions.length;
  expect(html.includes("Billed a promotion")).toBe(each !== null);
  // A bound past a quarter is a figure like any other, since no hold reads it (16 October); with no
  // total to price against, the runway says nothing.
  const risky: CampaignReading = {
    ...reading,
    counters: { ...reading.counters, risk: risk === null ? null : { ...risk, union: 0.4 }, runway: null },
  };
  const held = paneOf(risky);
  expect(held).toContain(`at most <b class="ana-num">40%</b> over 2 attempts`);
  expect(held.includes("past the table")).toBe(false);
  expect(held.includes("Comparisons left")).toBe(false);
});

test("the harness strip keeps every card closed in one row and shows the selected one's detail under it", () => {
  const reading = readingOf(fixture.name);
  const html = paneOf(reading, `?harness=${fixture.harnesses.b}`);
  const strip = /<ul class="ana-harness-strip"[^>]*>(.*?)<\/ul>/.exec(html)?.[1] ?? "";
  expect(strip).not.toContain("ana-harness-detail");
  expect(strip.match(/class="ana-harness is-selected"/g)?.length).toBe(1);
  const after = html.slice(html.indexOf("</ul>", html.indexOf("ana-harness-strip")));
  expect(after).toContain('class="ana-harness-detail"');
  expect(after).toContain("Builder session b-2");
  // The starter is named by the route before any comparison names its digest.
  const unnamed: CampaignReading = {
    ...reading,
    harnesses: reading.harnesses.map((card) => (card.starter ? { ...card, digest: null } : card)),
  };
  const starter = paneOf(unnamed, "?harness=starter");
  expect(/<li class="ana-harness is-selected"><button[^>]*>.*?<\/button><\/li>/.exec(starter)?.[0]).toContain(
    "Starter",
  );
  expect(starter).toContain("named at the first comparison");
});

test("the comparisons chart reads whole tasks at an even step, and keeps a few columns together at the left", () => {
  expect(countTicks(8)).toEqual([0, 2, 4, 6, 8]);
  expect(countTicks(7)).toEqual([0, 2, 4, 6, 8]);
  expect(countTicks(3)).toEqual([0, 1, 2, 3]);
  expect(countTicks(23)).toEqual([0, 5, 10, 15, 20, 25]);
  const few = paneOf(readingOf(fixture.units));
  expect(few).toMatch(/class="ana-comparisons-frame" style="width:\d+px"/);
  const many = paneOf(readingOf(fixture.name));
  expect(many).toMatch(/class="ana-comparisons-frame" style="min-width:\d+px"/);
});

test("an attended campaign says so in its set-up, and that a promotion the table names waits for the operator's word", () => {
  const attended = readingOf(fixture.early);
  const unattended = readingOf(fixture.name);
  expect([attended.attended, unattended.attended]).toEqual([true, false]);
  expect(paneOf(attended)).toContain("<dt>attended</dt>");
  expect(paneOf(unattended)).not.toContain("<dt>attended</dt>");
  const promote = {
    move: "promote",
    why: "a step read twice",
    harness: "h",
    line: "next · promote",
    code: "twice",
  } as const;
  const waits = "under --attended the promotion waits for the operator&#x27;s word";
  expect(paneOf({ ...attended, nextMove: promote })).toContain(waits);
  expect(paneOf({ ...unattended, nextMove: promote })).not.toContain(waits);
});

test("the set-up names the bars a promotion is read against, and the next move the row of the table that chose it", () => {
  const reading = readingOf(fixture.name);
  // No opening of the fixture sets a bar, so each stands at its default.
  expect(reading.bars).toEqual({ cost: 3 });
  const html = paneOf(reading);
  expect(html).toContain("<dt>bars</dt>");
  expect(html).toContain("cost 3 attempts, gating nothing");
  const promote = {
    move: "promote",
    why: "a step read twice",
    harness: "h",
    line: "next · promote",
    code: "twice",
  } as const;
  expect(paneOf({ ...reading, nextMove: promote })).toContain('title="twice · next · promote"');
});

test("a campaign says who leads it, and reads the table's next move as advice where its Builder does", () => {
  const hosted = readingOf(fixture.name);
  expect(hosted.led).toBe(false);
  const compare = {
    move: "compare",
    code: "new",
    why: "a harness to compare",
    fresh: "latest",
    reference: "h",
    line: "next · compare",
  } as const;
  const [byHost, byBuilder] = [
    paneOf({ ...hosted, nextMove: compare }),
    paneOf({ ...hosted, led: true, nextMove: compare }),
  ];
  expect(byHost).toContain("the host: it makes each move the table names");
  expect(byHost).toContain("Next move");
  expect(byHost).not.toContain("Table advises");
  expect(byBuilder).toContain("its Builder: one conversation makes the moves");
  expect(byBuilder).toContain("Table advises");
  expect(byBuilder).toContain("the Builder leads this campaign and may make another move");
  // The exam's set-up is the host's whoever leads.
  const prepare = {
    move: "prepare",
    code: "apart",
    why: "no task is set apart",
    line: "next · prepare",
  } as const;
  expect(paneOf({ ...hosted, led: true, nextMove: prepare })).not.toContain("Table advises");
});

test("a comparison cut before its report stands at its scored tasks, never at zero, and one still open says so", () => {
  const reading = readingOf(fixture.name);
  const cut = reading.comparisons.find((bar) => bar.cut);
  if (cut === undefined) throw new Error("the fixture's main campaign holds a cut comparison");
  const slot = comparisonSlots(reading.comparisons).find((each) => each.key === cut.id);
  expect(slot?.kind === "bar" ? slot.values : null).toEqual({ open: cut.tasks });
  expect(rowCells(paneOf(reading), cut.id)).toEqual(["cut before a report", "none"]);
  const open: ComparisonBar = { ...cut, cut: false };
  const html = paneOf({
    ...reading,
    comparisons: reading.comparisons.map((bar) => (bar === cut ? open : bar)),
  });
  expect(rowCells(html, cut.id)[0]).toBe("no report yet");
  expect(html).toContain("No report yet");
});

test("what the view prints beside the readouts is one click or one line away: the set-up, the open steps, the regression, the last write", () => {
  const reading = readingOf(fixture.name);
  const html = paneOf(reading);
  const { supply } = reading;
  expect(html).toContain(
    '<details class="ana-disclosure"><summary><span class="ana-caret" aria-hidden="true">›</span>Set-up</summary>',
  );
  expect(html).toContain(
    `${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(supply.awaiting)} wait for a label · ${String(supply.exhausted)} exhausted · checker read, 0 faults, frozen`,
  );
  for (const seat of ["builder", "examiner", "reviewer", "solver"]) {
    expect(html).toContain(`<dt>${seat}</dt>`);
  }
  expect(html).toContain("<dt>target</dt>");
  expect(reading.open).toEqual(["b-5"]);
  expect(html).toContain("on the log as it stands with b-5 open");
  expect(html).toContain("last wrote ");
  const { labels } = reading.counters;
  expect(html).toContain(
    `Waiting for a label: tasks <b class="ana-num">${String(labels.tasks)}</b>, rejections set aside in unsettled comparisons <b class="ana-num">${String(labels.rejections)}</b>`,
  );
  const units = readingOf(fixture.units);
  if (units.regression === null) {
    throw new Error("the units campaign reads two candidates against one reference");
  }
  const { wins, losses, ties } = units.regression;
  expect(paneOf(units)).toContain(`<b class="ana-num">${String(wins)}–${String(losses)}–${String(ties)}</b>`);
  expect(paneOf(units)).toContain("Regression check");
});
