import { afterAll, beforeAll, describe, test } from "bun:test";
import type { Browser, Locator, Page } from "@playwright/test";
import {
  accessibilityViolations,
  choicesOf,
  choose,
  chooser,
  DESKTOP,
  expect,
  expectQuiet,
  keepAnswers,
  launchBrowser,
  type Opened,
  openPage,
  PHONE,
  routeParameters,
  type Served,
  serveFixture,
  type Viewing,
} from "./browser.ts";
import { expectFocusRing, tabTo } from "./browser-watch.ts";
import { answersOver, MARKERS } from "./fixture-campaign.ts";

/*
 * The Log pane in Chrome over the fixture's timeline: one line a thing that happened, newest first,
 * a session's and a solve's turns and calls counted into its own line (`server/log.ts`); the Kind
 * and Session choices and the search, all in the browser; a line opening its move, solve or task;
 * and the raw event, which the exam tier alone opens.
 */

let served: Served;
let exam: Served;
let browser: Browser;
let lines: number;
let events: number;

beforeAll(async () => {
  [served, exam, browser] = await Promise.all([serveFixture(), serveFixture("exam"), launchBrowser()]);
  const timeline = answersOver(served.fixture.root, "default").log({ key: served.fixture.key });
  lines = timeline.rows.length;
  events = timeline.events;
});
afterAll(async () => {
  await browser.close();
  await Promise.all([served.stop(), exam.stop()]);
});

/** The Log pane of the fixture's campaign on `server`, with its lines read. */
async function openLog(server: Served, viewing: Viewing = DESKTOP): Promise<Opened> {
  const url = server.url(`campaign=${encodeURIComponent(server.fixture.key)}&pane=log`);
  const opened = await openPage(browser, url, viewing);
  await expect(counter(opened.page)).toHaveText(`${String(lines)} lines`);
  return opened;
}

const counter = (page: Page): Locator =>
  page
    .getByRole("main")
    .getByRole("status")
    .filter({ hasText: /\blines$/u });
const table = (page: Page): Locator => page.getByRole("main").getByRole("table");
const line = (page: Page, starts: string): Locator =>
  table(page).getByRole("button", { name: new RegExp(`^${starts}`, "u") });

/** The text of every "What happened" cell drawn. */
function said(page: Page): Promise<string[]> {
  return table(page).locator("tbody td.ana-log-what").allInnerTexts();
}

describe("the Log pane", () => {
  test("says what happened newest first, a session's and a solve's turns and calls inside its own line", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    expect(lines).toBeLessThan(events / 3);
    const drawn = await said(page);
    expect(drawn).toHaveLength(200);
    // No line is a bare turn or call, and every line is words rather than an event's kind.
    expect(drawn.filter((text) => /^\S+\.\S+$/u.test(text))).toEqual([]);
    expect(drawn.some((text) => /\d+ turns?, \d+ calls?$/u.test(text))).toBe(true);
    await page.getByRole("button", { name: `Show ${String(lines - 200)} more` }).click();
    expect(await said(page)).toHaveLength(lines);
    await page.getByRole("button", { name: "At", exact: true }).click();
    expect((await said(page))[0]).toBe("Campaign opened · vowel-counts · solver faux/solver-1");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("narrows by kind, by session and by search, and clears all three at once", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    expect(await choicesOf(page, "Kind")).toEqual([
      `Every kind ${String(lines)}`,
      "Campaign 26",
      "Sessions and comparisons 26",
      "Tasks 26",
      "Solves 182",
      "Harnesses 8",
    ]);
    const words = (choices: string[]) => choices.map((choice) => choice.replace(/ \d+$/u, ""));
    expect(words(await choicesOf(page, "Session")).slice(0, 4)).toEqual([
      "Every session",
      "No session",
      "d-1",
      "x-1",
    ]);
    await choose(page, "Kind", "Solves");
    await expect(counter(page)).toHaveText(`182 of ${String(lines)} lines`);
    // A choice counts the rows the other choices leave, and offers no value they leave none of.
    const sessions = await choicesOf(page, "Session");
    expect(sessions).toContain("b-1 25");
    expect(words(sessions)).not.toContain("d-1");
    expect((await said(page)).every((text) => text.startsWith("Solve "))).toBe(true);
    await choose(page, "Session", "b-1");
    await expect(counter(page)).toHaveText(`25 of ${String(lines)} lines`);
    await page.getByRole("searchbox", { name: /^Search/u }).fill("rejected");
    const rejected = await said(page);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((text) => text.includes("· b-1 · rejected"))).toBe(true);
    await page.getByRole("searchbox", { name: /^Search/u }).fill("nothing-says-this");
    await expect(page.getByText("No matching lines")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(counter(page)).toHaveText(`${String(lines)} lines`);
    await expect(chooser(page, "Kind")).toHaveText("Every kind");
    await expect(chooser(page, "Session")).toHaveText("Every session");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("opens a line where its detail lives: its solve, its move or its task", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    await page.getByRole("searchbox", { name: /^Search/u }).fill("s-3-1");
    await line(page, "Solve s-3-1 ·").click();
    expect(routeParameters(page)).toMatchObject({ pane: "moves", solve: "s-3-1" });
    await page.goBack();
    await page.getByRole("searchbox", { name: /^Search/u }).fill("Move: build");
    await line(page, "Move: build").last().click();
    expect(routeParameters(page)).toMatchObject({ pane: "moves", move: "53" });
    await page.goBack();
    await page.getByRole("searchbox", { name: /^Search/u }).fill("word-02");
    await line(page, "Task word-02").click();
    expect(routeParameters(page)).toMatchObject({ pane: "tasks" });
    expect(routeParameters(page).task).toHaveLength(64);
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the raw event and the keyboard", () => {
  test("opens a line's first event raw on the exam tier alone", async () => {
    const opened = await openLog(exam);
    const { page } = opened;
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    await page.getByRole("button", { name: "At", exact: true }).click();
    await table(page).getByRole("button", { name: "#1", exact: true }).click();
    expect(routeParameters(page)).toMatchObject({ event: "1" });
    const inspector = page.getByRole("complementary", { name: "Event" });
    await expect(inspector).toContainText("draft.started");
    await inspector.getByRole("button", { name: "Close" }).click();
    await expect(inspector).toHaveCount(0);
    expectQuiet(opened);
    await opened.context.close();
    const plain = await openLog(served);
    await expect(table(plain.page).getByRole("button", { name: /^#\d+$/u })).toHaveCount(0);
    expectQuiet(plain);
    await plain.context.close();
  });

  test("reaches the choices and the lines by keyboard, each with a visible ring", async () => {
    const opened = await openLog(served);
    const { page } = opened;
    const kind = chooser(page, "Kind");
    await tabTo(page, kind);
    await expectFocusRing(kind);
    await page.keyboard.press("Tab");
    await expectFocusRing(chooser(page, "Session"));
    const first = table(page).locator("tbody button").first();
    await tabTo(page, first);
    await expectFocusRing(first);
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the Log pane's layout and wall", () => {
  test("scrolls the table inside its card on a phone, never the page", async () => {
    const opened = await openLog(served, PHONE);
    const { page } = opened;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("in the default tier shows and receives no exam-side value", async () => {
    const opened = await openPage(browser, "about:blank");
    const { page } = opened;
    const answers = await keepAnswers(page);
    await page.goto(served.url(`campaign=${encodeURIComponent(served.fixture.key)}&pane=log`));
    await expect(counter(page)).toHaveText(`${String(lines)} lines`);
    await page.getByRole("button", { name: `Show ${String(lines - 200)} more` }).click();
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
