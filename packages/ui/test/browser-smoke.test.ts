/**
 * The page the operator opens, in Chrome over `serve.ts` on the fixture (`browser.ts`): two smoke
 * tests of what only a drawn page can show. In the default tier, no pane, move, solve or task
 * shows or receives anything of the exam side (`MARKERS`), and the page reports no error while it
 * draws them; held upright on a phone, every pane fits the screen's width and breaks no WCAG 2.2 AA
 * rule axe checks. What the page computes before it draws is `view-model.test.ts`, and what the
 * server answers is `readings.test.ts` and `server.test.ts`.
 */
import { afterAll, beforeAll, test } from "bun:test";
import type { Browser, Page } from "@playwright/test";
import { PANES } from "../src/route.ts";
import {
  accessibilityViolations,
  drawn,
  expect,
  expectQuiet,
  keepAnswers,
  launchBrowser,
  openPage,
  PHONE,
  type Served,
  serveFixture,
} from "./browser.ts";
import { answersOver, MARKERS } from "./fixture-campaign.ts";

let served: Served;
let browser: Browser;

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture(), launchBrowser()]);
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

/** The page at `query` within the fixture's main campaign, once it has drawn, and its text. */
async function shown(page: Page, query: string): Promise<string> {
  await page.goto(served.url(`campaign=${encodeURIComponent(served.fixture.key)}&${query}`));
  await expect.poll(() => drawn(page)).toBe("settled");
  return page.locator("body").innerText();
}

test("in the default tier shows and receives nothing of the exam side on any pane, move, solve or task", async () => {
  const { fixture } = served;
  const moves = answersOver(fixture.root, "default").campaign(fixture.key).moves;
  const opened = await openPage(browser, "about:blank");
  const { page } = opened;
  const read = await keepAnswers(page);
  const solves = [
    fixture.practiceSolve,
    fixture.heldOutSolve,
    fixture.ruledSolve,
    fixture.unreportedSolve,
    ...fixture.withheld,
  ];
  const queries = [
    ...PANES.map((pane) => `pane=${pane}`),
    ...moves.map((move) => `pane=moves&move=${String(move.index)}`),
    ...solves.map((solve) => `pane=moves&solve=${solve}`),
    ...[fixture.awaiting, fixture.disputed].map((task) => `pane=tasks&task=${task}`),
    ...Object.values(fixture.harnesses).map((digest) => `harness=${digest}`),
  ];
  const texts: string[] = [];
  for (const query of queries) texts.push(await shown(page, query));
  expect(read.length).toBeGreaterThan(queries.length);
  // The nearest hostile case: the pages drew the fixture's solves rather than an empty shell, and
  // every marker is one the exam tier answers with (`readings.test.ts`, "the wall between the tiers").
  const pages = texts.join("\n");
  expect([fixture.practiceSolve, fixture.heldOutSolve].filter((solve) => !pages.includes(solve))).toEqual([]);
  for (const marker of Object.values(MARKERS)) {
    expect(texts.filter((text) => text.includes(marker))).toEqual([]);
    expect(read.filter((body) => body.includes(marker))).toEqual([]);
  }
  expectQuiet(opened);
  await opened.context.close();
});

test("fits every pane to a phone's width and breaks no WCAG 2.2 AA rule there", async () => {
  const opened = await openPage(browser, "about:blank", PHONE);
  const { page } = opened;
  for (const pane of PANES) {
    await shown(page, `pane=${pane}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect([pane, Math.max(0, overflow)]).toEqual([pane, 0]);
    expect([pane, await accessibilityViolations(page, "main")]).toEqual([pane, []]);
  }
  expectQuiet(opened);
  await opened.context.close();
});
