import { afterAll, beforeAll, describe, test } from "bun:test";
import type { Browser, Page } from "@playwright/test";
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

/** Where the column of comparison `id` stands, from its axis label: its middle, and a height inside
 *  the plot where a pointer is over the column's band. */
async function columnPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const tick = page.locator(".ana-comparisons-tick text").filter({ hasText: new RegExp(`^${id}$`, "u") });
  const box = await tick.boundingBox();
  if (box === null) throw new Error(`no axis label for ${id}`);
  return { x: box.x + box.width / 2, y: box.y - 60 };
}

describe("the campaign's line and readouts", () => {
  test("shows the campaign state, readouts, promotion marks, small charts and counters", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const head = page.locator(".ana-campaign-head");
    await expect(head.locator("h1")).toHaveText(served.fixture.name);
    await expect(head.locator(".ana-eyebrow")).toHaveCount(0);
    await expect(head.locator(".ana-campaign-status")).toContainText("open");
    await expect(head.locator(".ana-campaign-status")).toContainText(/\w{3} \d+, /u);
    await expect(head.locator(".ana-campaign-status")).toContainText("$7.49 of $40.00");
    // The campaign returned to the starter: the readout names it by the log's name for it.
    const reference = readout(page, "Reference harness");
    await expect(reference.value).toHaveText("Starter A");
    await expect(reference.detail).toHaveText(/\b3\b.*promotions.*starter/u);
    const last = readout(page, "Last reading");
    await expect(last.value).toHaveText("3–1–2");
    await expect(last.detail).toHaveText(/no-step.*g-9.*p 0\.31\d\b/u);
    const next = readout(page, "Next move");
    await expect(next.value).toHaveText("Comparison");
    await expect(next.detail).toContainText(/b-4.*not reported/u);
    const { a, c } = served.fixture.harnesses;
    const marks = page.locator(".ana-comparisons-marks");
    // A flag carries the harness's letter alone, and its words and digest only on hover.
    await expect(marks.locator("text")).toContainText(["setting", "cut", "B", "D", "A"]);
    const titles = await marks.locator("title").allTextContents();
    expect(titles).toContain(
      `promoted D (${short(c)}), despite: the operator's reason, given with --despite`,
    );
    expect(titles).toContain("back to the starter");
    expect(titles).toContain(`promoted B (${short(a)})`);
    expect(titles).toContain("r-1 repeats b-1");
    expect(titles).toContain("r-3 repeats b-3");
    expect(titles.some((title) => /setting.*[a-f0-9]{8}/iu.test(title))).toBe(true);
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
    const share = page.locator(".ana-campaign-small", { hasText: "Wins by measure" });
    for (const measure of ["validity", "objective", "bill"]) await expect(share).toContainText(measure);
    // One column a comparison that reported: the cut one has none.
    for (const id of COLUMNS.filter((each) => each !== "b-4")) await expect(share).toContainText(id);
    const dollars = page.locator(".ana-campaign-small", { hasText: "Dollars billed" });
    await expect(dollars).toContainText("17 moves");
    await expect(dollars).toContainText("budget $40.00");
    const counters = page.locator(".ana-campaign-counters");
    await expect(counters.locator(".ana-num").first()).toHaveText("1 of 6");
    await expect(counters).toContainText(/label: tasks 1\b.*rejections.*\b2\b/u);
    await expect(counters).toContainText(/A\/A controls 7\b.*\b0\b.*step/u);
    await expect(counters).toContainText(/False promotion.*\b6\.3%.*\b1 attempt/u);
    await expect(counters.locator(".ana-num").last()).toHaveText("42");

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
      /\b13\b.*frontier.*\b2\b.*practice.*\b1\b.*label.*\b1\b.*exhausted.*retained/u,
    );
    await expect(body).toContainText(/checker.*\b0\b.*faults.*frozen/u);
    await expect(body.getByText(/faux\/solver-1.*high/u)).toBeVisible();
    await expect(body.getByText(/the host:/u)).toBeVisible();
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
    await expect(tooltip.locator(":scope > .ana-num")).toContainText(
      /\b3 won.*\b0 lost.*\b3 tied.*no-step.*0\.10\b.*0\.125\b/u,
    );
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
});

describe("the comparison table", () => {
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
});

describe("the other campaigns", () => {
  test("a campaign with no comparison says in the chart's place what it holds to compare", async () => {
    const opened = await openCampaign("early");
    const { page } = opened;
    const chart = page.locator(".ana-campaign-chart");
    await expect(chart.getByText("No comparison yet")).toBeVisible();
    await expect(chart.locator(".ana-nosignal p")).toContainText(
      /\b6 held-out.*\b2\b.*practice.*comparison.*\b6\b/u,
    );
    await expect(chart.locator("svg.recharts-surface")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Outcomes, tasks over every comparison" })).toHaveCount(0);
    await expect(page.locator(".ana-campaign-small")).toHaveCount(1);
    await expect(page.locator(".ana-campaign-small")).toContainText("Dollars billed");
    await expect(readout(page, "Reference harness").value).toHaveText("Starter");
    await expect(readout(page, "Reference harness").detail).toHaveText("no promotion yet");
    await expect(readout(page, "Last reading").value).toHaveText("None");
    await expect(readout(page, "Last reading").detail).toHaveText("no comparison has reported");
    await expect(page.getByRole("heading", { name: "Wins by measure" })).toHaveCount(0);
    await expect(page.locator(".ana-campaign-counters")).toContainText("A/A controls 0");
    await page.locator(".ana-disclosure > summary").click();
    await expect(page.locator(".ana-disclosure-body")).toContainText(/freeze.*promotion.*operator/u);
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a campaign ended on its budget shows its ending in place of the next move, and no promotion", async () => {
    const opened = await openCampaign("units");
    const { page } = opened;
    await expect(page.locator(".ana-campaign-head h1")).toHaveText(served.fixture.units);
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
      await expect(page.locator(".ana-harness-files .ana-harness-entry")).toHaveCount(3);
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
