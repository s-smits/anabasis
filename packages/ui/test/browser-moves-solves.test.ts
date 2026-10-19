/**
 * A solve opened from the Moves pane, in the default tier: its facts, its trace with each call
 * collapsed under its number and tool, what the tier withholds and why, and that nothing of the
 * exam side reaches the page or any answer it read (`MARKERS`). The exam side's own server is
 * `browser-moves-exam.test.ts`.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, type Page } from "@playwright/test";
import type { Move } from "../src/models.ts";
import {
  accessibilityViolations,
  expect,
  expectQuiet,
  keepAnswers,
  launchBrowser,
  type Opened,
  openPage,
  type Served,
  serveFixture,
} from "./browser.ts";
import { answersOver, MARKERS } from "./fixture-campaign.ts";

const EXAM_SIDE = "start the server with --exam-side to open it.";
/** The fixture's one non-result, a provider failure of comparison b-1 solved again as s-10-2. */
const NON_RESULT = "s-10-1";
const LABEL_LINE = "The ruling is withheld while its rejection waits for a person's label, in either tier.";

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

function indexOf(id: string, step: Move["step"]): number {
  const found = moves.find((move) => move.id === id && move.step === step);
  if (found === undefined) throw new Error(`no ${step} ${id} in the fixture`);
  return found.index;
}

/** The query of a move's detail, and of a solve opened from it where one is named; a solve may be
 *  opened by its link with no move. */
function movesQuery(move: number | null, solve?: string): string {
  const pane = `campaign=${encodeURIComponent(served.fixture.key)}&pane=moves`;
  const query = move === null ? pane : `${pane}&move=${String(move)}`;
  return solve === undefined ? query : `${query}&solve=${solve}`;
}

function solveHeading(page: Page, id: string) {
  return page.getByRole("heading", { level: 2, name: `${id} Solve` });
}

/** The solve's own part of the page: the move it was opened from stays mounted, hidden. */
function solvePart(page: Page, id: string) {
  return page.locator(`[aria-label="Solve ${id}"]`);
}

async function openSolve(move: number | null, solve: string): Promise<Opened> {
  const opened = await openPage(browser, served.url(movesQuery(move, solve)));
  await expect(solveHeading(opened.page, solve)).toBeVisible();
  return opened;
}

describe("a solve in the default tier", () => {
  test("a practice solve: its trace, each call collapsed under its number and tool, and no ruling", async () => {
    const opened = await openPage(browser, served.url(movesQuery(indexOf("b-1", "builder"))));
    const { page } = opened;
    const id = served.fixture.practiceSolve;
    await page.getByRole("button", { name: id, exact: true }).click();
    await expect(solveHeading(page, id)).toBeVisible();
    const part = solvePart(page, id);
    await expect(part.locator(".ana-detail-badges")).toHaveText(/practice task\s*rejected/u);
    await expect(part.getByRole("heading", { name: "Trace · 2 turns" })).toBeVisible();
    await expect(part.getByRole("heading", { name: "Ruling" })).toHaveCount(0);
    const calls = part.locator("details.ana-tool-call");
    await expect(calls).toHaveCount(2);
    expect(
      await calls.evaluateAll((all) => all.map((each) => each instanceof HTMLDetailsElement && each.open)),
    ).toEqual([false, false]);
    const summaries = await calls
      .locator("summary")
      .evaluateAll((all) =>
        all.map((each) => [...each.children].slice(0, 2).map((child) => child.textContent)),
      );
    expect(summaries).toEqual([
      ["1", "bash"],
      ["2", "write"],
    ]);
    await expect(part.getByText("cat task.json")).toBeHidden();
    await calls.first().locator("summary").click();
    await expect(part.getByRole("heading", { name: "Command" })).toBeVisible();
    await expect(part.getByText("cat task.json")).toBeVisible();
    await expect(part.getByText("a short word")).toBeVisible();
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    await page.getByRole("button", { name: "Back to b-1" }).click();
    await expect(page.getByRole("button", { name: id, exact: true })).toBeFocused();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a held-out solve: its verdict and trace stay on the exam side, each said where it is", async () => {
    const id = served.fixture.heldOutSolve;
    const opened = await openSolve(indexOf("b-1", "comparison"), id);
    const { page } = opened;
    const part = solvePart(page, id);
    await expect(part.locator(".ana-detail-badges")).toHaveText(/held-out task\s*valid/u);
    await expect(part).toContainText(
      `The exam side holds the verdict, with the answer and the checks that refused it: ${EXAM_SIDE}`,
    );
    await expect(part).toContainText(
      `The exam side holds the trace of a held-out task's solve: ${EXAM_SIDE}`,
    );
    await expect(part.getByRole("heading", { name: "Trace", exact: true })).toBeVisible();
    await expect(part.locator("details.ana-tool-call")).toHaveCount(0);
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a ruled rejection: its ruling is on the exam side; a rejection waiting for a label says it is withheld", async () => {
    const ruled = await openSolve(indexOf("b-1", "comparison"), served.fixture.ruledSolve);
    await expect(solvePart(ruled.page, served.fixture.ruledSolve)).toContainText(
      `The exam side holds the Referee's ruling and its reason: ${EXAM_SIDE}`,
    );
    expectQuiet(ruled);
    await ruled.context.close();
    const [waiting = ""] = served.fixture.withheld;
    const opened = await openPage(browser, served.url(movesQuery(indexOf("b-1", "comparison"))));
    const { page } = opened;
    await page.getByRole("button", { name: `rejected, solve ${waiting}` }).click();
    await expect(solveHeading(page, waiting)).toBeVisible();
    await expect(solvePart(page, waiting).getByText(LABEL_LINE)).toBeVisible();
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a rejection of a comparison cut before its report: its ruling waits for the report", async () => {
    const opened = await openPage(browser, served.url(movesQuery(indexOf("b-4", "comparison"))));
    const { page } = opened;
    const id = served.fixture.unreportedSolve;
    await page.getByRole("button", { name: `rejected, solve ${id}` }).click();
    await expect(solveHeading(page, id)).toBeVisible();
    await expect(
      solvePart(page, id).getByText("The ruling is withheld until its comparison reports, in either tier."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to b-4" }).click();
    await expect(page.getByRole("button", { name: `rejected, solve ${id}` })).toBeFocused();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a non-result: drawn as its kind, and the solve that replaced it is the one the comparison scored", async () => {
    const opened = await openSolve(indexOf("b-1", "comparison"), NON_RESULT);
    const { page } = opened;
    await expect(solvePart(page, NON_RESULT).locator(".ana-detail-badges")).toHaveText(
      /held-out task\s*provider/u,
    );
    await expect(solvePart(page, NON_RESULT).getByRole("heading", { name: "Ruling" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to b-1" }).click();
    const word02 = page.getByRole("row", { name: /^word-02 / });
    await expect(word02.getByRole("button", { name: "valid, solve s-10-2" })).toBeVisible();
    await expect(word02.getByRole("button", { name: new RegExp(`solve ${NON_RESULT}$`, "u") })).toHaveCount(
      0,
    );
    expectQuiet(opened);
    await opened.context.close();
  });

  test("no hidden value, answer or check name reaches the page or any answer it read", async () => {
    const opened = await openPage(browser, "about:blank");
    const { page } = opened;
    const read = await keepAnswers(page);
    const texts: string[] = [];
    const solves = [
      [indexOf("b-1", "builder"), served.fixture.practiceSolve],
      [indexOf("b-1", "comparison"), served.fixture.heldOutSolve],
      [indexOf("b-1", "comparison"), served.fixture.ruledSolve],
      [indexOf("b-1", "comparison"), NON_RESULT],
      [indexOf("b-4", "comparison"), served.fixture.unreportedSolve],
      ...served.fixture.withheld.map((id) => [null, id] as const),
    ] as const;
    for (const move of moves) {
      await page.goto(served.url(movesQuery(move.index)));
      await expect(page.locator(`[aria-label^="Move "] .ana-detail`)).toBeVisible();
      texts.push(await page.locator("body").innerText());
    }
    for (const [move, id] of solves) {
      await page.goto(served.url(movesQuery(move, id)));
      await expect(solveHeading(page, id)).toBeVisible();
      texts.push(await page.locator("body").innerText());
    }
    expect(read.length).toBeGreaterThan(moves.length + solves.length);
    for (const marker of Object.values(MARKERS)) {
      expect(texts.filter((text) => text.includes(marker))).toEqual([]);
      expect(read.filter((body) => body.includes(marker))).toEqual([]);
    }
    expectQuiet(opened);
    await opened.context.close();
  });
});
