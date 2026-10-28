/**
 * The Moves pane on the exam side (`serve.ts --exam-side`): what the default tier withholds is
 * shown in its place, a verdict with its answer and the check that refused it, a ruling with its
 * reason, a held-out solve's trace and an Examiner session's turns, while a ruling that waits for a
 * person's label stays withheld in this tier too.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import type { Browser, Page } from "@playwright/test";
import type { Move } from "../src/models.ts";
import {
  accessibilityViolations,
  expect,
  expectQuiet,
  launchBrowser,
  openPage,
  type Served,
  serveFixture,
} from "./browser.ts";
import { answersOver, MARKERS } from "./fixture-campaign.ts";

let served: Served;
let browser: Browser;
let moves: readonly Move[];

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture("exam"), launchBrowser()]);
  moves = answersOver(served.fixture.root, "exam").campaign(served.fixture.key).moves;
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

function movesUrl(id: string, step: Move["step"], solve?: string): string {
  const move = moves.find((each) => each.id === id && each.step === step);
  if (move === undefined) throw new Error(`no ${step} ${id} in the fixture`);
  const query = `campaign=${encodeURIComponent(served.fixture.key)}&pane=moves&move=${String(move.index)}`;
  return served.url(solve === undefined ? query : `${query}&solve=${solve}`);
}

function solvePart(page: Page, id: string) {
  return page.locator(`[aria-label="Solve ${id}"]`);
}

describe("the Moves pane on the exam side", () => {
  test("a held-out solve shows its verdict, its answer and its trace", async () => {
    const id = served.fixture.heldOutSolve;
    const opened = await openPage(browser, movesUrl("b-1", "comparison", id));
    const { page } = opened;
    const part = solvePart(page, id);
    await expect(part.getByRole("heading", { level: 2, name: `${id} Solve` })).toBeVisible();
    await expect(part.locator("dl.ana-facts").filter({ hasText: "Verdict" })).toContainText("pass");
    await expect(part).toContainText(MARKERS.answer);
    await expect(part.getByRole("heading", { name: "Trace · 2 turns" })).toBeVisible();
    await expect(part.locator("details.ana-tool-call")).toHaveCount(2);
    await expect(part).not.toContainText("The exam side holds");
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a ruled rejection shows the check that refused it and the Referee's ruling with its reason", async () => {
    const id = served.fixture.ruledSolve;
    const opened = await openPage(browser, movesUrl("b-1", "comparison", id));
    const { page } = opened;
    const part = solvePart(page, id);
    await expect(part.getByRole("heading", { level: 2, name: `${id} Solve` })).toBeVisible();
    await expect(part.locator("code", { hasText: MARKERS.check })).toBeVisible();
    await expect(part.getByText("earned", { exact: true })).toBeVisible();
    await expect(part.getByText("by the Referee")).toBeVisible();
    await expect(part.getByText(/ruled earned$/u)).toBeVisible();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a rejection waiting for a person's label keeps its ruling withheld here too", async () => {
    const [waiting = ""] = served.fixture.withheld;
    const opened = await openPage(browser, movesUrl("b-1", "comparison"));
    const { page } = opened;
    await page.getByRole("button", { name: `rejected, solve ${waiting}` }).click();
    const part = solvePart(page, waiting);
    await expect(part.getByRole("heading", { name: "Ruling" })).toBeVisible();
    await expect(
      part.getByText(
        "The ruling is withheld while its rejection waits for a person's label, in either tier.",
      ),
    ).toBeVisible();
    await expect(part.locator("code", { hasText: MARKERS.check })).toBeVisible();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("an Examiner session shows its turns and calls, and a comparison its rulings by solve", async () => {
    const opened = await openPage(browser, movesUrl("x-1", "examiner"));
    const { page } = opened;
    await expect(page.getByRole("heading", { level: 2, name: "x-1 Examiner session" })).toBeVisible();
    const summaries = page.locator("main details.ana-tool-call summary strong");
    await expect(summaries).toHaveText(["propose_tasks", "finish"]);
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    await page.goto(movesUrl("b-1", "comparison"));
    await expect(
      page
        .getByRole("row", { name: /^word-01 / })
        .getByRole("cell")
        .last(),
    ).toHaveText(/earned\s*earned/u);
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });
});
