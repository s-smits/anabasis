/**
 * The Moves pane in a browser: the list of moves with its search, its kind filter and the
 * promotions between its rows; a row's detail opened in place and left by the page's Back, the
 * browser's back; Examiner, Builder and comparison details; the keyboard; a phone's width;
 * and what axe-core finds at WCAG 2.2 AA on the list and each detail.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import type { Browser, Page } from "@playwright/test";
import type { Move } from "../src/models.ts";
import {
  accessibilityViolations,
  expect,
  expectQuiet,
  launchBrowser,
  type Opened,
  openPage,
  PHONE,
  routeParameters,
  type Served,
  serveFixture,
  type Viewing,
} from "./browser.ts";
import { answersOver } from "./fixture-campaign.ts";

const SEARCH = "Search moves by id, kind or harness";

let served: Served;
let browser: Browser;
let moves: readonly Move[];

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture(), launchBrowser()]);
  moves = answersOver(served.fixture.root, "default").campaign(served.fixture.key).moves;
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

/** The place in the log of the move with this id and kind. */
function indexOf(id: string, step: Move["step"]): number {
  const found = moves.find((move) => move.id === id && move.step === step);
  if (found === undefined) throw new Error(`no ${step} ${id} in the fixture`);
  return found.index;
}

/** The Moves pane, or one move's detail in it. */
function openMoves(move: number | null = null, viewing: Viewing = {}): Promise<Opened> {
  const query = `campaign=${encodeURIComponent(served.fixture.key)}&pane=moves`;
  return openPage(browser, served.url(move === null ? query : `${query}&move=${String(move)}`), viewing);
}

/** The badges beside a detail's title. */
function badgesOf(page: Page) {
  return page.locator("main .ana-detail-badges");
}

function rowOf(page: Page, index: number) {
  return page.locator(`[data-row="${String(index)}"]`);
}

/** The heading of a detail: its id, then what it is. */
function detailHeading(page: Page, name: string) {
  return page.getByRole("heading", { level: 2, name });
}

/** The term and definition pairs of the facts lists under `scope`, as text. */
async function factsOf(page: Page, scope = "main"): Promise<Record<string, string>> {
  const pairs = await page
    .locator(`${scope} dl > div`)
    .evaluateAll((items) =>
      items.map((item): [string, string] => [
        item.querySelector("dt")?.textContent ?? "",
        item.querySelector("dd")?.textContent ?? "",
      ]),
    );
  return Object.fromEntries(pairs);
}

async function expectAccessible(page: Page): Promise<void> {
  expect(await accessibilityViolations(page, "main")).toEqual([]);
}

describe("the list of moves", () => {
  test("lists every move in log order, its promotion dividers and its facts in separate columns", async () => {
    const opened = await openMoves();
    const { page } = opened;
    await expect(page.getByRole("columnheader", { name: "Moves (17)" })).toBeVisible();
    const ids = await page.locator("main tbody .ana-row-select").allTextContents();
    expect(ids).toEqual(moves.map((move) => move.id));
    const rows = await page.locator("main tbody tr").allTextContents();
    expect(rows.filter((row) => /^(?:Promoted|Returned) /u.test(row)).length).toBe(3);
    const promoted = rows.find((row) => row.startsWith("Promoted"));
    expect(promoted).toMatch(/^Promoted B \(fa7c79d2\) to reference on b-1, r-1 /u);
    // The promotion stands between the step's repeat and the next move.
    const at = rows.findIndex((row) => row.startsWith("Promoted"));
    expect([rows[at - 1]?.slice(0, 3), rows[at + 1]?.slice(0, 3)]).toEqual(["r-1", "x-2"]);
    expect(rows.some((row) => row.startsWith("Returned the reference to the starter on c-1 "))).toBe(true);
    expect(rows.some((row) => / to reference on .+ despite the rule /u.test(row))).toBe(true);
    // The pane speaks of promotions, never of epochs or a climb: not in a row, a filter or a placeholder.
    expect(await page.locator("main").innerHTML()).not.toMatch(/epoch|climb/u);
    await expectAccessible(page);
    const headers = await page.locator("main thead th").allTextContents();
    expect(headers).toEqual(["Moves (17)", "Stands", "Handed over", "Cost", "Ran", "Started"]);
    const cells = await rowOf(page, indexOf("b-1", "comparison"))
      .locator("xpath=ancestor::tr")
      .locator("td")
      .allInnerTexts();
    expect(cells.slice(0, 5)).toEqual([
      expect.stringMatching(/b-1\s+Comparison.*row new/u),
      expect.stringMatching(/no-step\s+25 of 25\b.*ended/u),
      expect.stringMatching(/B.*fa7c79d2.*Starter A.*\b6 tasks.*\b2\b.*\b3 won.*\b0 lost.*\b3 tied/u),
      "$0.93",
      "1 h 57 min",
    ]);
    expect(cells[5]).toMatch(/^Sep 2[89], \d\d:\d\d:\d\d [AP]M$/u);
    const open = await rowOf(page, indexOf("b-5", "builder")).locator("xpath=ancestor::tr").innerText();
    expect(open).toContain("open");
    expect(open).toContain("2 turns so far");
    expect(open).toContain("no end");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("finds moves by id, by kind and by harness, and says so when none matches", async () => {
    const opened = await openMoves();
    const { page } = opened;
    const search = page.getByRole("searchbox", { name: SEARCH });
    const ids = () => page.locator("main tbody .ana-row-select").allTextContents();
    for (const [query, expected] of [
      ["x-", ["x-1", "x-2", "x-3", "x-4"]],
      ["control", ["c-1"]],
      ["10615418", ["b-4", "b-4"]],
    ] as const) {
      await search.fill(query);
      await expect(
        page.getByRole("columnheader", { name: `Moves (${String(expected.length)})` }),
      ).toBeVisible();
      expect(await ids()).toEqual([...expected]);
      expect(await page.locator("main tr.ana-move-divider").count()).toBe(0);
    }
    await search.fill("nothing-like-this");
    await expect(page.getByText("No matching move")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
    await expect(page.locator("main table")).toHaveCount(0);
    await expectAccessible(page);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("columnheader", { name: "Moves (17)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("filters by kind, and clears the kind with the search", async () => {
    const opened = await openMoves();
    const { page } = opened;
    const kind = page.getByRole("combobox", { name: "Kind" });
    const count = (step: Move["step"]) => moves.filter((move) => move.step === step).length;
    for (const step of ["examiner", "builder", "comparison"] as const) {
      await kind.selectOption(step);
      await expect(page.getByRole("columnheader", { name: `Moves (${String(count(step))})` })).toBeVisible();
      const ids = await page.locator("main tbody .ana-row-select").allTextContents();
      expect(ids).toEqual(moves.flatMap((move) => (move.step === step ? [move.id] : [])));
    }
    await page.getByRole("searchbox", { name: SEARCH }).fill("b-4");
    await expect(page.getByRole("columnheader", { name: "Moves (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(kind).toHaveValue("all");
    await expect(page.getByRole("columnheader", { name: "Moves (17)" })).toBeVisible();
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("a move's detail in place", () => {
  test("opens with the list hidden, and Back restores the filtered list, its search and the focus", async () => {
    const opened = await openMoves();
    const { page } = opened;
    const search = page.getByRole("searchbox", { name: SEARCH });
    await search.fill("b-1");
    await page.getByRole("combobox", { name: "Kind" }).selectOption("comparison");
    const row = rowOf(page, indexOf("b-1", "comparison"));
    await row.click();
    await expect(detailHeading(page, "b-1 Comparison")).toBeVisible();
    await expect(search).toBeHidden();
    expect(routeParameters(page)).toMatchObject({
      pane: "moves",
      move: String(indexOf("b-1", "comparison")),
    });
    await page.getByRole("button", { name: "Back to moves" }).click();
    await expect(row).toBeFocused();
    await expect(search).toHaveValue("b-1");
    await expect(page.getByRole("combobox", { name: "Kind" })).toHaveValue("comparison");
    await expect(page.getByRole("columnheader", { name: "Moves (1)" })).toBeVisible();
    expect(routeParameters(page).move).toBeUndefined();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("goes back to the list with the browser's back button as with its own", async () => {
    const opened = await openMoves();
    const { page } = opened;
    await page.getByRole("searchbox", { name: SEARCH }).fill("x-");
    const row = rowOf(page, indexOf("x-2", "examiner"));
    await row.click();
    await expect(detailHeading(page, "x-2 Examiner session")).toBeVisible();
    await page.goBack();
    await expect(row).toBeFocused();
    await expect(page.getByRole("searchbox", { name: SEARCH })).toHaveValue("x-");
    await page.goForward();
    await expect(detailHeading(page, "x-2 Examiner session")).toBeVisible();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("is reached, opened and left from the keyboard, with the focus drawn", async () => {
    const opened = await openMoves();
    const { page } = opened;
    await page.getByRole("combobox", { name: "Kind" }).focus();
    await page.keyboard.press("Tab");
    const first = rowOf(page, indexOf("x-1", "examiner"));
    await expect(first).toBeFocused();
    const ring = await first.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        visible: element.matches(":focus-visible"),
        outline: style.outlineStyle,
        width: style.outlineWidth,
      };
    });
    expect(ring.visible).toBe(true);
    expect(ring.outline).not.toBe("none");
    expect(ring.width).not.toBe("0px");
    await page.keyboard.press("Tab");
    const second = rowOf(page, indexOf("b-1", "builder"));
    await expect(second).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detailHeading(page, "b-1 Builder session")).toBeVisible();
    await expect(page.locator('[aria-label="Move b-1"]')).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Back to moves" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(second).toBeFocused();
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("each kind of move", () => {
  test("an Examiner session: what it proposed and held out, its turns on the exam side", async () => {
    const opened = await openMoves(indexOf("x-1", "examiner"));
    const { page } = opened;
    await expect(detailHeading(page, "x-1 Examiner session")).toBeVisible();
    expect(await factsOf(page)).toMatchObject({ Proposed: "15", "Held out": "14", Refused: "1", Turns: "2" });
    await expect(badgesOf(page)).toHaveText("finished");
    await expect(page.getByText(/--exam-side/u)).toBeVisible();
    await expectAccessible(page);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a Builder session: its parent, the harness it left, its practice solves and its turns", async () => {
    const opened = await openMoves(indexOf("b-1", "builder"));
    const { page } = opened;
    await expect(detailHeading(page, "b-1 Builder session")).toBeVisible();
    expect(await factsOf(page)).toMatchObject({
      Parent: "Starter A",
      Left: "B (fa7c79d2)",
      "Practice solves": "2",
      Failed: "1",
      Turns: "3",
    });
    await expect(page.getByRole("button", { name: "Compare with starter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "agent/BUILT_AGENTS.md" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Practice solves (2)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "s-1-1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "s-2-1" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Turns and calls · 3 turns" })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("button", { name: "s-1-1" }).click();
    await expect(detailHeading(page, "s-1-1 Solve")).toBeVisible();
    await page.getByRole("button", { name: "Back to b-1" }).click();
    await expect(page.getByRole("button", { name: "s-1-1" })).toBeFocused();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a comparison: its tally and reading, its scored tasks filtered by outcome, each side's solves", async () => {
    const opened = await openMoves(indexOf("b-1", "comparison"));
    const { page } = opened;
    await expect(detailHeading(page, "b-1 Comparison")).toBeVisible();
    expect(await factsOf(page)).toMatchObject({
      Tally: expect.stringMatching(/\b3 won.*\b0 lost.*\b3 tied/u),
      "Sign test": expect.stringMatching(/p 0\.125\b.*level 0\.1\b/u),
      "Valid, reference": "3 of 12 solves",
      "Valid, new": "8 of 12 solves",
    });
    await expect(badgesOf(page)).toHaveText("no-step");
    await expect(page.getByRole("heading", { name: "Scored tasks (6)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lost 0" })).toBeDisabled();
    await page.getByRole("button", { name: "Won 3" }).click();
    await expect(page.getByRole("heading", { name: "Scored tasks (3 of 6)" })).toBeVisible();
    await page.getByRole("button", { name: "Show every task" }).click();
    await expect(page.getByRole("heading", { name: "Scored tasks (6)" })).toBeVisible();
    // Two solves a side on each task, each named by its solve.
    const word01 = page.getByRole("row", { name: /^word-01 / });
    await expect(
      word01.getByRole("button", { name: /^(valid|rejected|no-answer), solve s-\d+-1$/u }),
    ).toHaveCount(4);
    await expect(word01.getByRole("cell", { name: "2 rejections, ruled on the exam side" })).toBeVisible();
    await expect(page.getByRole("row", { name: /^word-06 / })).toContainText(/withheld.*label/u);
    await expectAccessible(page);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a control: the starter against the reference, with the reference against itself beside it", async () => {
    const opened = await openMoves(indexOf("c-1", "comparison"));
    const { page } = opened;
    await expect(detailHeading(page, "c-1 Comparison, control")).toBeVisible();
    await expect(page.getByText(/^Starter A against the reference B \(fa7c79d2\)/u)).toBeVisible();
    expect(await factsOf(page)).toMatchObject({
      Tally: expect.stringMatching(/\b1 won.*\b1 lost.*\b0 tied/u),
      "Reference against itself": expect.stringMatching(/\b1 won.*\b0 lost.*p 0\.500\b/u),
      Rulings: expect.stringMatching(/\b3 rejections.*withheld/u),
    });
    await expect(page.getByRole("button", { name: "Set aside for a label 1" })).toBeEnabled();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Back to moves" }).click();
    await expect(rowOf(page, indexOf("c-1", "comparison"))).toBeFocused();
    expect(routeParameters(page).move).toBeUndefined();
    await page.goBack();
    await expect(detailHeading(page, "c-1 Comparison, control")).toBeVisible();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a comparison cut before its report: the tasks it fixed, and no outcome", async () => {
    const opened = await openMoves(indexOf("b-4", "comparison"));
    const { page } = opened;
    await expect(detailHeading(page, "b-4 Comparison")).toBeVisible();
    await expect(badgesOf(page)).toHaveText("cut");
    await expect(page.locator("main .ana-detail").getByText(/5 of 5 solves ended/u)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tasks fixed (3)" })).toBeVisible();
    await expect(page.getByText("no report yet", { exact: true })).toHaveCount(3);
    await expect(page.getByText(/ran no end/u)).toBeVisible();
    await expectAccessible(page);
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the Moves pane at a phone's width", () => {
  test("scrolls its tables sideways inside their surface, never the page", async () => {
    const opened = await openMoves(null, PHONE);
    const { page } = opened;
    await expect(page.getByRole("columnheader", { name: "Moves (17)" })).toBeVisible();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const wrapScrolls = () =>
      page
        .locator("main .ana-table-wrap")
        .first()
        .evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(await wrapScrolls()).toBe(true);
    await expectAccessible(page);
    await rowOf(page, indexOf("b-1", "comparison")).click();
    await expect(detailHeading(page, "b-1 Comparison")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    // A withheld ruling is a sentence; its column keeps the width to read it.
    const rulings = page
      .getByRole("row", { name: /^word-06 / })
      .getByRole("cell")
      .last();
    expect((await rulings.boundingBox())?.width).toBeGreaterThanOrEqual(200);
    await expectAccessible(page);
    expectQuiet(opened);
    await opened.context.close();
  });
});
