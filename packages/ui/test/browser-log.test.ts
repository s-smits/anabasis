import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, expect, type Locator, type Page } from "@playwright/test";
import {
  accessibilityViolations,
  DESKTOP,
  expectQuiet,
  launchBrowser,
  nextPolls,
  type Opened,
  openPage,
  PHONE,
  routeParameters,
  type Served,
  serveFixture,
  type Viewing,
  withClock,
} from "./browser.ts";
import {
  arm,
  expectFocusRing,
  framesOf,
  mutationsOf,
  tabTo,
  watchFrames,
  watchMutations,
} from "./browser-watch.ts";
import { answersOver, MARKERS } from "./fixture-campaign.ts";

/*
 * The Log pane in Chrome over the fixture's 1,495 events: the reader's disclosure, the Kind and
 * Session filters the server applies before it pages, the paging and its counter, an event opened
 * in the inspector on either tier, the columns under their heads, and what the page paints while a
 * page or an event is read: the page before, never a placeholder in its place (14 October).
 */

const EVENTS = 1495;
const PAGE = 100;

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

/** The Log pane of the fixture's campaign on `server`, with `extra` added to the query. */
function logAt(server: Served, extra = ""): string {
  return server.url(`campaign=${encodeURIComponent(server.fixture.key)}&pane=log${extra}`);
}

/** The pane, with its first page read. */
async function openLog(server: Served, extra = "", viewing: Viewing = DESKTOP): Promise<Opened> {
  const opened = await openPage(browser, logAt(server, extra), viewing);
  await expect(counter(opened.page)).toHaveText(`1–${String(PAGE)} of ${String(EVENTS)} events`);
  return opened;
}

const counter = (page: Page): Locator => page.getByRole("status").filter({ hasText: /\bof \d+ events?\b/u });
const rows = (page: Page): Locator => page.getByRole("button", { name: /^#\d+$/u });
const row = (page: Page, index: number): Locator =>
  page.getByRole("button", { name: `#${String(index)}`, exact: true });
const reader = (page: Page): Locator => page.locator("summary").filter({ hasText: "The reader:" });
const table = (page: Page): Locator => page.getByRole("main").getByRole("table");

/** How many of the log's events a filter matches, as the server's handler counts them. */
function matching(filter: { kind?: string; session?: string }): number {
  return answersOver(served.fixture.root, "default").log({ key: served.fixture.key, ...filter }).matching;
}

/** The text of every cell in column `at` of the table's body. */
function columnTexts(page: Page, at: number): Promise<string[]> {
  return table(page)
    .locator(`tbody tr > :nth-child(${String(at + 1)})`)
    .allInnerTexts();
}

/** The pane with its frames watched from the first (`watchFrames`). */
async function openWatched(server: Served, regions: readonly string[], busy: string): Promise<Opened> {
  const opened = await openPage(browser, "about:blank");
  await watchFrames(opened.context, regions, busy);
  await opened.page.goto(logAt(server));
  await expect(counter(opened.page)).toHaveText(`1–${String(PAGE)} of ${String(EVENTS)} events`);
  return opened;
}

describe("the Log pane", () => {
  test("says how many rows and triggers the reader holds, and opens them on a click", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    const summary = reader(page);
    await expect(summary).toHaveText(/The reader: 6 rows, 62 triggers$/u);
    await expect(summary).toBeVisible();
    const disclosure = page.locator("details", { has: summary });
    await expect(disclosure).not.toHaveAttribute("open");
    await summary.click();
    await expect(disclosure).toHaveAttribute("open");
    await expect(disclosure.locator("dt")).toHaveCount(6);
    await expect(disclosure.getByText(/exam side holds/u)).toBeVisible();
    await summary.click();
    await expect(disclosure).not.toHaveAttribute("open");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("on the exam side holds back no trigger", async () => {
    const opened = await openLog(exam);
    await expect(reader(opened.page)).toHaveText(/The reader: 6 rows, 73 triggers$/u);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("pages the log a hundred events at a time, Previous closed on the first and Next on the last", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    const previous = page.getByRole("button", { name: "Previous" });
    const next = page.getByRole("button", { name: "Next" });
    await expect(rows(page)).toHaveCount(PAGE);
    await expect(rows(page).first()).toHaveText("#0");
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(counter(page)).toHaveText("101–200 of 1495 events");
    await expect(rows(page).first()).toHaveText("#100");
    await expect(previous).toBeEnabled();
    await previous.click();
    await expect(counter(page)).toHaveText("1–100 of 1495 events");
    await expect(previous).toBeDisabled();
    const pages = Math.ceil(EVENTS / PAGE);
    for (let at = 1; at < pages; at += 1) await next.click();
    await expect(counter(page)).toHaveText(`1401–${String(EVENTS)} of ${String(EVENTS)} events`);
    await expect(rows(page)).toHaveCount(EVENTS - 1400);
    await expect(rows(page).last()).toHaveText(`#${String(EVENTS - 1)}`);
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();
    // The paging lives in the pane, and the address names the pane alone.
    expect(routeParameters(page)).toEqual({ campaign: served.fixture.key, pane: "log" });
    expectQuiet(opened);
    await opened.context.close();
  });

  test("filters by kind and by session before it pages, and a filter starts again at the first page", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    const kind = page.getByLabel("Kind");
    const session = page.getByLabel("Session");
    await expect(kind).toHaveValue("all");
    await expect(session).toHaveValue("all");
    expect(await kind.locator("option").allInnerTexts()).toContain("solve.finished");
    expect(await session.locator("option").allInnerTexts()).toEqual([
      "Every session",
      "d-1",
      "x-1",
      "b-1",
      "r-1",
      "x-2",
      "c-1",
      "b-2",
      "b-3",
      "r-3",
      "x-3",
      "b-4",
      "g-9",
      "x-4",
      "b-5",
    ]);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(counter(page)).toHaveText("201–300 of 1495 events");

    const inB1 = matching({ session: "b-1" });
    await session.selectOption("b-1");
    await expect(counter(page)).toHaveText(`1–100 of ${String(inB1)} events`);
    expect(new Set(await columnTexts(page, 3))).toEqual(new Set(["b-1"]));
    await page.getByRole("button", { name: "Next" }).click();
    await expect(counter(page)).toHaveText(`101–${String(inB1)} of ${String(inB1)} events`);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    const finishedInB1 = matching({ kind: "solve.finished", session: "b-1" });
    await kind.selectOption("solve.finished");
    await expect(counter(page)).toHaveText(`1–${String(finishedInB1)} of ${String(finishedInB1)} events`);
    await expect(rows(page)).toHaveCount(finishedInB1);
    expect(new Set(await columnTexts(page, 2))).toEqual(new Set(["solve.finished"]));
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    await session.selectOption("all");
    const finished = matching({ kind: "solve.finished" });
    await expect(counter(page)).toHaveText(`1–100 of ${String(finished)} events`);

    // A pair no event holds: the campaign's opening belongs to no session.
    await kind.selectOption("campaign.opened");
    await session.selectOption("b-2");
    await expect(counter(page)).toHaveText("0 of 0 events");
    await expect(page.getByText("No matching event")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(counter(page)).toHaveText("1–100 of 1495 events");
    await expect(kind).toHaveValue("all");
    await expect(session).toHaveValue("all");
    await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("sets every column's head over its cells", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    const heads = await table(page).locator("thead th").allTextContents();
    expect(heads).toEqual(["Event", "At", "Kind", "Session", "Solve"]);
    // The head's text and each cell's text, by their own boxes: a column whose cells sit apart from
    // its head, as the times did until 14 October, shares no horizontal stretch with it.
    const apart = await table(page).evaluate((node) => {
      const box = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
      };
      const found: string[] = [];
      const head = [...node.querySelectorAll("thead th")];
      head.forEach((th, at) => {
        const over = box(th);
        for (const tr of node.querySelectorAll("tbody tr")) {
          const cell = tr.children[at];
          if (cell === undefined || cell.textContent.trim() === "") continue;
          const under = box(cell);
          if (Math.max(over.left, under.left) >= Math.min(over.right, under.right)) {
            found.push(`${th.textContent} over ${cell.textContent}`);
          }
        }
      });
      return found;
    });
    expect(apart).toEqual([]);
    expect(await columnTexts(page, 4)).toContain("s-3-1");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("in the default tier, an event says quietly that the exam side holds it", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    await row(page, 5).click();
    expect(routeParameters(page)).toMatchObject({ event: "5" });
    const inspector = page.getByRole("complementary", { name: "Event" });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("#5");
    await expect(inspector).toContainText(
      "The exam side holds a raw event's payload: start the server with --exam-side to open it.",
    );
    await expect(inspector).not.toContainText("draft.finished");
    await expect(row(page, 5)).toHaveAttribute("aria-current", "true");
    expect(await accessibilityViolations(page)).toEqual([]);
    await inspector.getByRole("button", { name: "Close" }).click();
    await expect(inspector).toHaveCount(0);
    expect(routeParameters(page).event).toBeUndefined();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("on the exam side opens an event's payload in the inspector and closes it", async () => {
    const opened = await openLog(exam);
    const { page } = opened;
    await row(page, 5).click();
    expect(routeParameters(page)).toMatchObject({ event: "5" });
    const inspector = page.getByRole("complementary", { name: "Event" });
    await expect(inspector).toContainText("draft.finished");
    await expect(row(page, 5)).toHaveAttribute("aria-current", "true");
    await row(page, 6).click();
    expect(routeParameters(page)).toMatchObject({ event: "6" });
    await expect(inspector).toContainText("#6");
    await expect(row(page, 5)).not.toHaveAttribute("aria-current");
    expect(await accessibilityViolations(page)).toEqual([]);
    await inspector.getByRole("button", { name: "Close" }).click();
    await expect(inspector).toHaveCount(0);
    expect(routeParameters(page).event).toBeUndefined();
    // The browser's back reopens the event the close left.
    await page.goBack();
    await expect(page.getByRole("complementary", { name: "Event" })).toContainText("#6");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("opens the event a link names", async () => {
    const opened = await openLog(exam, "&event=5");
    const { page } = opened;
    await expect(page.getByRole("complementary", { name: "Event" })).toContainText("draft.finished");
    await expect(row(page, 5)).toHaveAttribute("aria-current", "true");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("reaches the filters and the rows by keyboard, each with a visible ring", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    const kind = page.getByLabel("Kind");
    await tabTo(page, kind);
    await expectFocusRing(kind);
    await page.keyboard.press("Tab");
    await expectFocusRing(page.getByLabel("Session"));
    await tabTo(page, row(page, 0));
    await expectFocusRing(row(page, 0));
    await page.keyboard.press("Tab");
    await expectFocusRing(row(page, 1));
    await page.keyboard.press("Enter");
    expect(routeParameters(page)).toMatchObject({ event: "1" });
    await tabTo(page, page.getByRole("button", { name: "Next" }), 200);
    await page.keyboard.press("Enter");
    await expect(counter(page)).toHaveText("101–200 of 1495 events");
    await expect(page.getByRole("button", { name: "Next" })).toBeFocused();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("breaks no accessibility rule, on either tier", async () => {
    for (const server of [served, exam]) {
      const opened = await openLog(server);
      await reader(opened.page).click();
      expect(await accessibilityViolations(opened.page, "main")).toEqual([]);
      expectQuiet(opened);
      await opened.context.close();
    }
  });

  test("scrolls the table inside its card on a phone, never the page", async () => {
    const opened = await openLog(served, "", PHONE);
    const { page } = opened;
    await expect(row(page, 0)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const card = page.locator(".ana-log .ana-table-wrap");
    expect(await card.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("in the default tier shows and receives no exam-side value", async () => {
    const opened = await openPage(browser, "about:blank");
    const { page } = opened;
    // Every answer read through the route, so that its body is kept: a read the page cancels for a
    // newer one keeps none to ask for once it has ended, which failed this test on CI on 14 October.
    const answers: string[] = [];
    await page.route("**/api/**", async (route) => {
      const response = await route.fetch();
      answers.push(await response.text());
      await route.fulfill({ response });
    });
    await page.goto(logAt(served));
    await expect(counter(page)).toHaveText("1–100 of 1495 events");
    await reader(page).click();
    await page.getByLabel("Session").selectOption("b-1");
    await expect(counter(page)).toHaveText(/of 192 events/u);
    await row(page, 87).click();
    await expect(page.getByRole("complementary", { name: "Event" })).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(answers.length).toBeGreaterThan(2);
    for (const marker of Object.values(MARKERS)) {
      expect(text).not.toContain(marker);
      for (const answer of answers) expect(answer).not.toContain(marker);
    }
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the Log pane between two pages", () => {
  test("paints the page before until the next arrives, through paging and filters", async () => {
    const opened = await openWatched(served, [".ana-log table"], ".ana-log[aria-busy=true]");
    const { page } = opened;
    await arm(page);
    const next = page.getByRole("button", { name: "Next" });
    await next.click();
    await expect(counter(page)).toHaveText("101–200 of 1495 events");
    await next.click();
    await expect(counter(page)).toHaveText("201–300 of 1495 events");
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(counter(page)).toHaveText("101–200 of 1495 events");
    await page.getByLabel("Kind").selectOption("solve.finished");
    await expect(counter(page)).toHaveText(/^1–100 of 182 events$/u);
    await page.getByLabel("Session").selectOption("b-1");
    await expect(counter(page)).toHaveText(/^1–25 of 25 events$/u);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(counter(page)).toHaveText("1–100 of 1495 events");
    const frames = await framesOf(page);
    expect(frames.frames).toBeGreaterThan(5);
    expect(frames.seen).toEqual([]);
    expect(frames.bad).toBe(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("keeps the page before through a slow read, and says it reads only once the read is late", async () => {
    const opened = await openWatched(served, [".ana-log table"], ".ana-log[aria-busy=true]");
    const { page } = opened;
    await expect(counter(page)).toHaveText("1–100 of 1495 events");
    const held = Promise.withResolvers<void>();
    // A server that takes a second and a half, or until the test has seen what it waits for.
    await page.route(/\/api\/log\?/u, async (route) => {
      await Promise.race([held.promise, Bun.sleep(1_500)]);
      await route.continue();
    });
    await arm(page);
    await page.getByRole("button", { name: "Next" }).click();
    // The first page stays, and the paging steps from the page asked for.
    await expect(row(page, 0)).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous" })).toBeEnabled();
    await expect(page.locator(".ana-log[aria-busy=true]")).toBeVisible();
    await expect(counter(page)).toHaveText("1–100 of 1495 events · reading");
    await expect(row(page, 0)).toBeVisible();
    held.resolve();
    await expect(counter(page)).toHaveText("101–200 of 1495 events");
    await expect(page.locator(".ana-log[aria-busy=true]")).toHaveCount(0);
    const frames = await framesOf(page);
    expect(frames.bad).toBe(0);
    expect(frames.busyAfter).toBeGreaterThanOrEqual(250);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("opens and closes an event on the exam side with no placeholder frame", async () => {
    const opened = await openWatched(exam, [".ana-log table"], "aside[aria-busy=true]");
    const { page } = opened;
    await arm(page);
    const inspector = page.getByRole("complementary", { name: "Event" });
    await row(page, 5).click();
    await expect(inspector).toContainText("draft.finished");
    await row(page, 7).click();
    await expect(inspector).toContainText("#7");
    await expect(inspector).toContainText("checker.read");
    await inspector.getByRole("button", { name: "Close" }).click();
    await expect(inspector).toHaveCount(0);
    const frames = await framesOf(page);
    const aside = await page.evaluate(() => document.body.innerText.includes("Reading the event"));
    expect(aside).toBe(false);
    expect(frames.seen).toEqual([]);
    expect(frames.bad).toBe(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("changes nothing in the table across two polls of unchanged data", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    await withClock(page);
    await watchMutations(page.locator(".ana-log"));
    await nextPolls(page, 2);
    expect(await mutationsOf(page)).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });
});
