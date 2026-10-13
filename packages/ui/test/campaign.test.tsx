// The Campaign pane, rendered from the readings the server's handlers give of the fixture's
// campaigns (`fixture-campaign.ts`), and so through the repository's folds.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { CountsTable } from "../src/components/charts/comparisons-key.tsx";
import type { CampaignReading, ComparisonBar, Outcome } from "../src/models.ts";
import { type Navigation, type RouteChange, routeOf } from "../src/route.ts";
import { CampaignPane } from "../src/views/campaign.tsx";
import { comparisonSlots, countTicks } from "../src/views/campaign-data.ts";
import { answersOver, type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

const OUTCOME_KEYS: readonly Outcome[] = ["won", "lost", "tiedEvery", "tiedSome", "tiedNone", "aside"];
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

test("a campaign with no comparison says what it holds to compare, in place of the chart", () => {
  const reading = readingOf(fixture.early);
  expect(reading.comparisons).toHaveLength(0);
  const html = paneOf(reading);
  expect(html).toContain("No comparison yet");
  expect(html).toContain(
    `${String(reading.supply.held)} held-out tasks can be scored, ${String(reading.supply.released)} released for practice.`,
  );
  expect(html).toContain("no comparison has reported");
  expect(html).not.toContain("ana-comparisons-key");
  expect(html).not.toContain("Valid share");
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

test("a campaign that ended with no promotion names its ending and draws no divider", () => {
  const reading = readingOf(fixture.units);
  expect(reading.promotions).toHaveLength(0);
  const html = paneOf(reading);
  expect(html).toContain("ended: budget");
  expect(html).toContain("Ending");
  expect(html).not.toContain("Next move");
  expect(html).toContain("no promotion yet");
  expect(html).not.toContain("<span>Promotion");
  expect(html).not.toContain("Back to the starter");
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

test("the outcome counts the page shows are the reading's, in the key and in every comparison's row", () => {
  const reading = readingOf(fixture.name);
  const html = paneOf(reading);
  for (const outcome of OUTCOME_KEYS) {
    let total = 0;
    for (const bar of reading.comparisons) total += bar.outcomes?.[outcome] ?? 0;
    expect(new RegExp(`data-outcome="${outcome}">(\\d+)<`).exec(html)?.[1]).toBe(String(total));
  }
  for (const bar of reading.comparisons) {
    if (bar.outcomes === null) continue;
    const counts = OUTCOME_KEYS.map((outcome) => String(bar.outcomes?.[outcome] ?? ""));
    expect(rowCells(html, bar.id)).toEqual([...counts, bar.reading ?? "none"]);
  }
});

test("a column opens its comparison by the move's place in the log, which a round shares its id with a session", () => {
  const reading = readingOf(fixture.name);
  const round = reading.comparisons.find((bar) =>
    reading.moves.some((m) => m.step === "builder" && m.id === bar.id),
  );
  if (round === undefined) throw new Error("the fixture's main campaign holds a round");
  const move = reading.moves.find((each) => each.index === round.move);
  expect([move?.step, move?.id]).toEqual(["comparison", round.id]);
  expect(reading.harnesses.flatMap((card) => card.comparedIn).find(({ id }) => id === round.id)?.move).toBe(
    round.move,
  );
});

test("each comparison opens from the keyboard: a native button in the counts table, which comes into view with focus", () => {
  const reading = readingOf(fixture.name);
  /** The props of an element this test reads: a button's, and any element's hiding. */
  interface Read {
    readonly type?: string;
    readonly disabled?: boolean;
    readonly tabIndex?: number;
    readonly "aria-hidden"?: boolean;
    readonly onClick?: () => void;
    readonly children?: ReactNode;
  }
  const buttons: Read[] = [];
  const visit = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      // SAFETY: an array among React children holds React children.
      for (const each of node as readonly ReactNode[]) visit(each);
      return;
    }
    if (!isValidElement(node)) return;
    // SAFETY: every element CountsTable returns is a host element, whose props are DOM attributes.
    const props = node.props as Read;
    expect(props["aria-hidden"]).not.toBe(true);
    if (node.type === "button") buttons.push(props);
    visit(props.children);
  };
  const opened: number[] = [];
  visit(CountsTable({ slots: comparisonSlots(reading.comparisons), onOpen: (move) => opened.push(move) }));
  // A native button that is enabled and in the tab order is focused by Tab and pressed by Enter and
  // Space, either of which fires its click.
  for (const button of buttons) {
    expect([button.type, button.disabled ?? false, (button.tabIndex ?? 0) >= 0]).toEqual([
      "button",
      false,
      true,
    ]);
    button.onClick?.();
  }
  expect(opened).toEqual(reading.comparisons.map((bar) => bar.move));
  expect(paneOf(reading)).toContain('<div class="ana-sr-only ana-shown-on-focus"><table class="ana-table">');
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
