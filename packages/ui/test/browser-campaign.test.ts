import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, type Page } from "@playwright/test";
import {
  accessibilityViolations,
  DESKTOP,
  expect,
  expectQuiet,
  launchBrowser,
  type Opened,
  openPage,
  PHONE,
  routeParameters,
  type Served,
  serveFixture,
} from "./browser.ts";

/*
 * The Campaign pane in Chrome, above the harness strip: the campaign's line, the three readouts,
 * the set-up, the comparisons chart with its marks, legend and table, the two small charts and
 * the counters, for each of the fixture's three campaigns, and the same pane on a server in the
 * exam tier. The strip and the inspector it opens are `browser-campaign-harnesses.test.ts`'s.
 *
 * The fixture's main campaign has eight comparisons, three promotions (one by the rule, one
 * despite it, one back to the starter), a change of setting, a control, two repeats and one
 * comparison cut before its report; `early` has none yet and `units` ended on its budget with no
 * promotion. Times are not asserted, since the page writes them in the browser's own zone.
 */

/** A box as the page measured it. */
interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

let served: Served;
let exam: Served;
let browser: Browser;

beforeAll(async () => {
  [served, exam, browser] = await Promise.all([serveFixture(), serveFixture("exam"), launchBrowser()]);
});
afterAll(async () => {
  await browser.close();
  await Promise.all([served.stop(), exam.stop()]);
});

const OUTCOME_LABELS = [
  "Won",
  "Lost",
  "Tied, reference always valid",
  "Tied, reference sometimes valid",
  "Tied, reference never valid",
  "Set aside for a label",
] as const;
const COLUMNS = ["b-1", "r-1", "c-1", "b-2", "b-3", "r-3", "b-4", "g-9"] as const;
const WIDTHS = [1024, 1280, DESKTOP.width, 1920, PHONE.width] as const;

/** The main campaign's Campaign pane, open at `width` (the desktop's by default). */
async function openCampaign(name = "fixture", width: number = DESKTOP.width): Promise<Opened> {
  const opened = await openPage(browser, served.url(`campaign=${campaignKey(name)}`), {
    width,
    height: width === PHONE.width ? PHONE.height : DESKTOP.height,
  });
  await expect(opened.page.getByRole("heading", { level: 1, name })).toBeVisible();
  return opened;
}

/** The server's key of one of the fixture's campaigns. */
function campaignKey(name: string): string {
  return served.fixture.key.replace(/fixture$/u, name);
}

function short(digest: string): string {
  return digest.slice(0, 8);
}

/** One of the three readouts, by its label: its value and its detail. */
function readout(page: Page, label: string) {
  const card = page
    .locator(".ana-metric")
    .filter({ has: page.locator(".ana-metric-label", { hasText: label }) });
  return { value: card.locator(".ana-metric-value"), detail: card.locator(".ana-metric-detail") };
}

/** Two boxes share some area, a hair's overlap of anti-aliased edges left out. */
function intersects(a: Box, b: Box): boolean {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

/** Every label drawn over the chart's columns and every promotion's divider, with the group each
 *  belongs to, so a divider is not held against its own label, and the chart's own box. */
function chartMarks(page: Page) {
  return page.evaluate(() => {
    const boxOf = (element: Element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const marks = document.querySelector(".ana-comparisons-marks");
    const svg = marks?.closest("svg");
    const groupOf = (element: Element) =>
      [...(marks?.children ?? [])].findIndex((each) => each.contains(element));
    const of = (selector: string) =>
      [...(marks?.querySelectorAll(selector) ?? [])].map((element) => ({
        text: element.textContent,
        group: groupOf(element),
        box: boxOf(element),
      }));
    return {
      labels: of("text"),
      dividers: of("g > line"),
      chart: svg === null || svg === undefined ? null : boxOf(svg),
    };
  });
}

/** Where the column of comparison `id` stands, from its axis label: its middle, and a height inside
 *  the plot where a pointer is over the column's band. */
async function columnPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const tick = page.locator(".ana-comparisons-tick text").filter({ hasText: new RegExp(`^${id}$`, "u") });
  const box = await tick.boundingBox();
  if (box === null) throw new Error(`no axis label for ${id}`);
  return { x: box.x + box.width / 2, y: box.y - 60 };
}

describe("the campaign's line and readouts", () => {
  test("name the project, the campaign, its state and its dollars, and the reference the starter", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const head = page.locator(".ana-campaign-head");
    await expect(head.locator(".ana-eyebrow")).toHaveText(served.fixture.projects.vowels);
    await expect(head.locator(".ana-campaign-status")).toContainText("open");
    await expect(head.locator(".ana-campaign-status")).toContainText(/last wrote \w{3} \d+, /u);
    await expect(head.locator(".ana-campaign-status")).toContainText("$7.49 of $40.00");
    // The campaign returned to the starter: the readout names it by the log's name for it.
    const reference = readout(page, "Reference harness");
    await expect(reference.value).toHaveText("Starter A");
    await expect(reference.detail).toHaveText("3 promotions, the last back to the starter");
    const last = readout(page, "Last reading");
    await expect(last.value).toHaveText("3–1–2");
    await expect(last.detail).toHaveText("no-step in g-9, won–lost–tied, p 0.31");
    const next = readout(page, "Next move");
    await expect(next.value).toHaveText("Comparison");
    await expect(next.detail).toContainText("comparison b-4 began and has not reported");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("keep the set-up closed until asked, by pointer or by keyboard", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const summary = page.locator(".ana-disclosure > summary", { hasText: "Set-up" });
    const body = page.locator(".ana-disclosure-body");
    const details = page.locator("details.ana-disclosure");
    await expect(body).toBeHidden();
    await summary.click();
    await expect(details).toHaveAttribute("open", "");
    await expect(body).toContainText(
      "11 held out on the frontier · 2 released for practice · 1 wait for a label · 3 exhausted, scored as retained",
    );
    await expect(body).toContainText("checker read, 0 faults, frozen");
    await expect(body.getByText("faux/solver-1 at high")).toBeVisible();
    await expect(body.getByText("the host: it makes each move the table names")).toBeVisible();
    await summary.click();
    await expect(body).toBeHidden();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(body).toBeVisible();
    await page.keyboard.press("Space");
    await expect(body).toBeHidden();
    // Opening it changes nothing the address says.
    expect(routeParameters(page)).toEqual({ campaign: served.fixture.key });
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the comparisons chart", () => {
  test("opens each column's comparison in Moves, as its row in the table does", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const table = page.locator(".ana-shown-on-focus table");
    const moves = new Map<string, string>();
    for (const id of COLUMNS) {
      await table.locator(`tr[data-comparison="${id}"] button`).press("Enter");
      await expect(page).toHaveURL(/pane=moves/u);
      await expect(
        page.getByRole("heading", { level: 2, name: new RegExp(`^${id} Comparison`, "u") }),
      ).toBeVisible();
      moves.set(id, routeParameters(page).move ?? "");
      await page.goBack();
      await expect(page).not.toHaveURL(/pane=moves/u);
    }
    expect(new Set(moves.values()).size).toBe(COLUMNS.length);
    for (const id of COLUMNS) {
      const { x, y } = await columnPoint(page, id);
      await page.mouse.move(x, y, { steps: 4 });
      await page.mouse.click(x, y);
      await expect(page).toHaveURL(new RegExp(`pane=moves&move=${moves.get(id) ?? ""}(&|$)`, "u"));
      await page.goBack();
      await expect(page.locator(".ana-comparisons-tick").first()).toBeVisible();
    }
    // The axis label is a way in of its own.
    await page.locator(".ana-comparisons-tick text").filter({ hasText: /^g-9$/u }).click();
    expect(routeParameters(page)).toMatchObject({ pane: "moves", move: moves.get("g-9") });
    expectQuiet(opened);
    await opened.context.close();
  });

  test("says what a column is of on hover, and from the keyboard", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const tooltip = page.locator(".ana-comparisons-tooltip");
    await expect(tooltip).toHaveCount(0);
    const first = await columnPoint(page, "b-1");
    await page.mouse.move(first.x, first.y, { steps: 4 });
    await expect(tooltip).toContainText("b-1");
    await expect(tooltip).toContainText("3 won, 0 lost, 3 tied · no-step · level 0.10 · p 0.13");
    const repeat = await columnPoint(page, "r-1");
    await page.mouse.move(repeat.x, repeat.y, { steps: 4 });
    await expect(tooltip.locator("strong")).toHaveText("r-1, repeat");
    await expect(tooltip).toContainText("repeating b-1");
    const cut = await columnPoint(page, "b-4");
    await page.mouse.move(cut.x, cut.y, { steps: 4 });
    await expect(tooltip).toContainText(/Cut before a report: \d+ of \d+ solves ended/u);
    const control = await columnPoint(page, "c-1");
    await page.mouse.move(control.x, control.y, { steps: 4 });
    await expect(tooltip.locator("strong")).toHaveText("c-1, control");
    await page.mouse.move(0, 0);
    await expect(tooltip).toHaveCount(0);
    // Recharts' keyboard layer: the chart takes focus and the arrows walk its columns.
    await page.locator(".ana-campaign-chart svg.recharts-surface").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator("strong")).toHaveText(/^[brcg]-\d/u);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("totals in its legend what its table counts, and shows the table when focus enters it", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const table = page.locator(".ana-shown-on-focus");
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(COLUMNS.length);
    await expect(rows.locator("th")).toHaveText([
      "b-1",
      "r-1, repeat",
      "c-1, control",
      "b-2",
      "b-3",
      "r-3, repeat",
      "b-4",
      "g-9",
    ]);
    // Each row's six counts and its reading word, as the fixture's comparisons tallied them.
    const cells = await rows.evaluateAll((each) =>
      each.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent)),
    );
    expect(cells).toEqual([
      ["3", "0", "1", "1", "1", "0", "no-step"],
      ["4", "0", "1", "0", "1", "0", "step"],
      ["1", "1", "0", "0", "0", "1", "no-step"],
      ["1", "1", "2", "1", "0", "0", "no-step"],
      ["3", "1", "1", "0", "0", "1", "no-step"],
      ["2", "1", "2", "0", "1", "0", "no-step"],
      ["cut before a report", "none"],
      ["3", "1", "1", "0", "1", "0", "no-step"],
    ]);
    const sums = OUTCOME_LABELS.map((_, at) =>
      cells.reduce((sum, row) => sum + (row.length > 2 ? Number(row[at]) : 0), 0),
    );
    expect(sums).toEqual([17, 5, 8, 2, 4, 2]);
    const legend = page.getByRole("list", { name: "Outcomes, tasks over every comparison" });
    for (const [at, label] of OUTCOME_LABELS.entries()) {
      await expect(legend.locator("li", { hasText: label }).first().locator(".ana-num")).toHaveText(
        String(sums[at]),
      );
    }
    await expect(legend).toContainText("No report yet");
    await expect(page.getByRole("list", { name: "Marks" }).locator("li")).toHaveText([
      "Promotion",
      "Promotion despite the rule",
      "Back to the starter",
      "Setting changed",
      "Control, drawn quieter",
      "Repeat of an earlier comparison",
      "Examiner session",
      "Builder session",
    ]);
    // Hidden at one pixel until focus enters it, then in view under the chart.
    expect((await table.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await table.getByRole("button", { name: "b-1" }).focus();
    await expect(table).toBeInViewport();
    expect((await table.boundingBox())?.width ?? 0).toBeGreaterThan(300);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("draws each promotion, the setting's change, the repeats, the sessions and the cut column", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const { a, c } = served.fixture.harnesses;
    const marks = page.locator(".ana-comparisons-marks");
    await expect(marks.locator("text")).toContainText([
      "setting ",
      "cut",
      `promoted B (${short(a)})`,
      `promoted D (${short(c)}), despite`,
      "back to the starter",
    ]);
    const titles = await marks.locator("title").allTextContents();
    expect(titles).toContain("the operator's reason, given with --despite");
    expect(titles).toContain("back to the starter");
    expect(titles).toContain(`promoted B (${short(a)})`);
    expect(titles).toContain("r-1 repeats b-1");
    expect(titles).toContain("r-3 repeats b-3");
    expect(titles.some((title) => title.startsWith("The setting changes here, to "))).toBe(true);
    expect(titles.some((title) => /^Examiner x-\d/u.test(title))).toBe(true);
    expect(titles.some((title) => /Builder b-\d/u.test(title))).toBe(true);
    // The return to the starter is the dashed divider; the promotion despite the rule an open flag.
    await expect(marks.locator("line[stroke-dasharray='5 4']")).toHaveCount(1);
    await expect(marks.locator("path[fill='var(--ana-card)']")).toHaveCount(1);
    // A step is named in full ink under its column, a control and a repeat by their kind.
    const ticks = page.locator(".ana-comparisons-tick");
    await expect(ticks.filter({ hasText: "r-1" })).toContainText("repeat, step");
    await expect(ticks.filter({ hasText: "r-1" }).locator("text.is-step")).toHaveText("r-1");
    await expect(ticks.filter({ hasText: "c-1" })).toContainText("control");
    expectQuiet(opened);
    await opened.context.close();
  });

  for (const width of WIDTHS) {
    test(`keeps every mark's label clear of the others, of each divider and of the chart's edge at ${String(width)} pixels`, async () => {
      const opened = await openCampaign("fixture", width);
      const { page } = opened;
      await expect(
        page.locator(".ana-comparisons-marks text").filter({ hasText: "back to the starter" }),
      ).toHaveCount(1);
      const { labels, dividers, chart } = await chartMarks(page);
      expect(chart).not.toBeNull();
      const crossings: string[] = [];
      for (const [at, label] of labels.entries()) {
        for (const other of labels.slice(at + 1)) {
          if (intersects(label.box, other.box)) {
            crossings.push(`"${label.text ?? ""}" and "${other.text ?? ""}"`);
          }
        }
        for (const divider of dividers) {
          if (divider.group !== label.group && intersects(label.box, divider.box)) {
            crossings.push(`"${label.text ?? ""}" and a divider at ${String(Math.round(divider.box.left))}`);
          }
        }
        if (chart !== null && (label.box.left < chart.left || label.box.right > chart.right)) {
          crossings.push(`"${label.text ?? ""}" past the chart's edge`);
        }
      }
      expect(crossings).toEqual([]);
      // Narrower than its columns, the chart scrolls inside its card and the page does not.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expectQuiet(opened);
      await opened.context.close();
    });
  }
});

describe("the small charts and the counters", () => {
  test("show the valid share and the dollars of every move, and the counters' line", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const share = page.locator(".ana-campaign-small", { hasText: "Valid share" });
    await expect(share).toContainText("Reference");
    await expect(share).toContainText("New harness");
    // One point a comparison that reported: the cut one has no share.
    for (const id of COLUMNS.filter((each) => each !== "b-4")) await expect(share).toContainText(id);
    const dollars = page.locator(".ana-campaign-small", { hasText: "Dollars billed" });
    await expect(dollars).toContainText("17 moves");
    await expect(dollars).toContainText("budget $40.00");
    const counters = page.locator(".ana-campaign-counters");
    await expect(counters).toContainText("Moves without a gain 1 of 6");
    await expect(counters).toContainText(
      "Waiting for a label: tasks 1, rejections set aside in unsettled comparisons 2",
    );
    await expect(counters).toContainText("A/A controls 1, 0 read a step");
    await expect(counters).toContainText(
      "False promotion under this reference estimated at 6.3% over 1 attempt",
    );
    await expect(counters).toContainText("Comparisons left at the last one's price 42");
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the other campaigns", () => {
  test("a campaign with no comparison says in the chart's place what it holds to compare", async () => {
    const opened = await openCampaign("early");
    const { page } = opened;
    const chart = page.locator(".ana-campaign-chart");
    await expect(chart.getByText("No comparison yet")).toBeVisible();
    await expect(chart).toContainText(
      "6 held-out tasks can be scored, 2 released for practice. A comparison scores 6.",
    );
    await expect(chart.locator("svg.recharts-surface")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Outcomes, tasks over every comparison" })).toHaveCount(0);
    await expect(page.locator(".ana-campaign-small")).toHaveCount(1);
    await expect(page.locator(".ana-campaign-small")).toContainText("Dollars billed");
    await expect(readout(page, "Reference harness").value).toHaveText("Starter");
    await expect(readout(page, "Reference harness").detail).toHaveText("no promotion yet");
    await expect(readout(page, "Last reading").value).toHaveText("None");
    await expect(readout(page, "Last reading").detail).toHaveText("no comparison has reported");
    await expect(page.getByRole("heading", { name: "Valid share" })).toHaveCount(0);
    await expect(page.locator(".ana-campaign-counters")).toContainText("A/A controls 0");
    await page.locator(".ana-disclosure > summary").click();
    await expect(page.locator(".ana-disclosure-body")).toContainText(
      "the freeze and a promotion wait for the operator's word",
    );
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a campaign ended on its budget shows its ending in place of the next move, and no promotion", async () => {
    const opened = await openCampaign("units");
    const { page } = opened;
    await expect(page.locator(".ana-campaign-head .ana-eyebrow")).toHaveText(served.fixture.projects.units);
    await expect(page.locator(".ana-campaign-status")).toContainText("ended: budget");
    await expect(readout(page, "Ending").value).toHaveText("budget");
    await expect(page.locator(".ana-metric-label")).toHaveText([
      "Reference harness",
      "Last reading",
      "Ending",
    ]);
    await expect(readout(page, "Reference harness").value).toHaveText("Starter");
    await expect(readout(page, "Reference harness").detail).toHaveText("no promotion yet");
    await expect(
      page.locator(".ana-comparisons-marks text").filter({ hasText: /promoted|back to/u }),
    ).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Marks" }).locator("li")).toHaveText([
      "Control, drawn quieter",
      "Examiner session",
      "Builder session",
    ]);
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("the exam side's server shows the same Campaign pane as the default tier's", async () => {
    const [plain, examSide] = await Promise.all([
      openCampaign(),
      openPage(browser, exam.url(`campaign=${exam.fixture.key}`)),
    ]);
    await expect(examSide.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    const pane = (page: Page) => page.locator(".ana-campaign").innerText();
    // Each page has read the selected card's files, the one part of the pane read after the rest.
    for (const { page } of [plain, examSide]) {
      await expect(page.locator(".ana-harness-files .ana-evidence-link")).toHaveCount(2);
    }
    expect(await pane(examSide.page)).toBe(await pane(plain.page));
    expectQuiet(plain);
    expectQuiet(examSide);
    await Promise.all([plain.context.close(), examSide.context.close()]);
  });
});

describe("accessibility", () => {
  test("the pane breaks no WCAG 2.2 AA rule, with its set-up open and its table in view", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    await page.locator(".ana-disclosure > summary").click();
    await page.locator(".ana-shown-on-focus").getByRole("button", { name: "b-1" }).focus();
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("the pane breaks none on a phone, and its table for the keyboard scrolls inside its card", async () => {
    const opened = await openCampaign("fixture", PHONE.width);
    const { page } = opened;
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    const shown = page.locator(".ana-shown-on-focus");
    await shown.getByRole("button", { name: "b-1" }).focus();
    await expect(shown.locator("table")).toBeVisible();
    // Shown at its own width the table made the page 331 px wider than a phone on 14 October.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    expect(await shown.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });
});
