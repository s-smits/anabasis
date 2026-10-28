import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, type Page, type Route } from "@playwright/test";
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
} from "./browser.ts";

/*
 * The Campaign pane's harness strip and the inspector it opens, in Chrome: the cards in the order
 * kept, a card chosen by pointer or by arrow key, the selected card's detail, the diff with its
 * parent and each of its files in the inspector, the back button undoing each, and the strip on a
 * phone. Then what a person sees between two states: a frame probe counts every animation frame in
 * which a watched part of the page is gone, empty or saying it is reading, across each step, since
 * on 14 October every card chosen and every file opened flashed a loading line for one to three
 * frames; a held read shows that the previous view stays and that the loading line waits.
 */

/** What the frame probe counted between its start and its stop. */
interface Frames {
  readonly frames: number;
  /** Frames in which the watched part was absent, after it had first been drawn. */
  readonly gone: number;
  /** Frames in which it stood but showed none of what it holds. */
  readonly empty: number;
  /** Frames in which it said it was reading, and the first such frame's time from the start. */
  readonly loading: number;
  readonly firstLoadingMs: number | null;
}

/** The probe, as the page holds it. */
interface FrameProbe {
  start(watched: string, content: string): void;
  stop(): Frames;
}

declare global {
  interface Window {
    anaFrames?: FrameProbe;
  }
}

const STRIP_FILES = { watched: ".ana-harness-detail", content: ".ana-harness-files .ana-evidence-link" };
const INSPECTOR = { watched: ".ana-inspector", content: ".ana-diff, .ana-file-content, .ana-record" };

let served: Served;
let browser: Browser;

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture(), launchBrowser()]);
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

/** A requestAnimationFrame loop over one part of the page (`watched`) that counts each frame in
 *  which it is gone, holds nothing matching `content`, or shows a line that starts "Reading ". It
 *  runs in the page, so it sees every frame the browser paints and not only the ones a test polls. */
function installFrameProbe(): void {
  let running = false;
  let seen = false;
  let began = 0;
  let [frames, gone, empty, loading] = [0, 0, 0, 0];
  let firstLoadingMs: number | null = null;
  const reading = (element: Element) =>
    [...element.querySelectorAll("p, span")].some((each) => each.textContent.startsWith("Reading "));
  const tick = (watched: string, content: string) => {
    if (!running) return;
    const element = document.querySelector(watched);
    frames += 1;
    if (element === null) {
      if (seen) gone += 1;
    } else {
      seen = true;
      if (element.querySelector(content) === null) empty += 1;
      if (reading(element)) {
        loading += 1;
        firstLoadingMs ??= performance.now() - began;
      }
    }
    requestAnimationFrame(() => tick(watched, content));
  };
  window.anaFrames = {
    start(watched, content) {
      [running, seen, began] = [true, false, performance.now()];
      [frames, gone, empty, loading, firstLoadingMs] = [0, 0, 0, 0, null];
      requestAnimationFrame(() => tick(watched, content));
    },
    stop() {
      running = false;
      return { frames, gone, empty, loading, firstLoadingMs };
    },
  };
}

/** Counts the frames of `watched` while `act` runs and until `settled` holds, plus two frames. */
async function watchFrames(
  page: Page,
  { watched, content }: { watched: string; content: string },
  act: () => Promise<void>,
  settled: () => Promise<void>,
): Promise<Frames> {
  await page.evaluate(installFrameProbe);
  await page.evaluate(([part, held]) => window.anaFrames?.start(part, held), [watched, content] as const);
  await act();
  await settled();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))),
  );
  const frames = await page.evaluate(() => window.anaFrames?.stop());
  if (frames === undefined) throw new Error("the frame probe was not installed");
  return frames;
}

function short(digest: string): string {
  return digest.slice(0, 8);
}

/** A harness as the page names it: the log's letter with its short digest. */
function named(letter: string, digest: string): string {
  return `${letter} (${short(digest)})`;
}

/** The card of a harness, by the letter and digest its name opens with. */
function cardOf(page: Page, letter: string, digest: string) {
  return strip(page).getByRole("button", { name: new RegExp(`^${letter}\\s*${short(digest)}`, "u") });
}

async function openCampaign(width?: number): Promise<Opened> {
  const opened = await openPage(
    browser,
    served.url(`campaign=${served.fixture.key}`),
    width === undefined ? {} : { width, height: PHONE.height },
  );
  await expect(opened.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
  await expect(opened.page.locator(".ana-harness-files .ana-evidence-link").first()).toBeVisible();
  return opened;
}

function strip(page: Page) {
  return page.getByRole("list", { name: "Harness versions; left and right move the selection" });
}

function selected(page: Page) {
  return strip(page).locator("button[aria-current='true']");
}

function detail(page: Page) {
  return page.locator("#ana-harness-panel");
}

/** The selected card stands wholly inside the strip's visible width. */
async function shownInStrip(page: Page): Promise<boolean> {
  const [list, card] = await Promise.all([strip(page).boundingBox(), selected(page).boundingBox()]);
  if (list === null || card === null) return false;
  return card.x >= list.x - 1 && card.x + card.width <= list.x + list.width + 1;
}

function inspector(page: Page) {
  return page.locator("aside.ana-inspector");
}

describe("the harness strip", () => {
  test("lists versions in kept order, selects the latest, and navigates by click, arrows and Back", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const { starter, a, b, c, d, e } = served.fixture.harnesses;
    // Each card is the log's letter over its short digest; the latest is the harness b-5 froze.
    await expect(strip(page).locator(".ana-harness-name")).toHaveText([
      `Starter A${short(starter)}`,
      `B${short(a)}`,
      `C${short(b)}`,
      `D${short(c)}`,
      `E${short(d)}`,
      `F${short(e)}`,
    ]);
    await expect(page.getByText("6 versions")).toBeVisible();
    await expect(strip(page).locator("li").first()).toContainText("reference");
    await expect(selected(page)).toContainText(short(e));
    await expect(selected(page)).toContainText("latest");
    await expect(detail(page)).toContainText(/Builder.*b-5/u);
    await expect(detail(page)).toContainText(`Parent${named("C", b)}`);
    await expect(detail(page)).toContainText("no practice solve");
    await expect(detail(page).locator(".ana-harness-files .ana-evidence-link")).toHaveText([
      "agent/BUILT_AGENTS.md",
      "agent/tools-spec.json",
    ]);
    await expect(detail(page).locator(".ana-harness-part > small")).toHaveText(["Guide", "Tools"]);

    await cardOf(page, "B", a).click();
    await expect(page).toHaveURL(new RegExp(`harness=${a}`, "u"));
    await expect(selected(page)).toContainText(short(a));
    await expect(selected(page)).toBeFocused();
    await expect(detail(page)).toContainText("4–0–2");
    await expect(
      detail(page).getByRole("list", { name: "Comparisons it was the new harness of" }),
    ).toContainText("r-1");
    await page.keyboard.press("ArrowRight");
    await expect(selected(page)).toContainText(short(b));
    await expect(selected(page)).toBeFocused();
    expect(routeParameters(page).harness).toBe(b);
    await page.keyboard.press("ArrowRight");
    expect(routeParameters(page).harness).toBe(c);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(selected(page)).toContainText("Starter");
    expect(routeParameters(page).harness).toBe("starter");
    await expect(detail(page)).toContainText("pi's coding agent");
    await expect(detail(page).getByRole("button", { name: "Compare with previous" })).toHaveCount(0);
    // At the first card the left arrow goes nowhere.
    await page.keyboard.press("ArrowLeft");
    expect(routeParameters(page).harness).toBe("starter");
    // The arrows replaced the click's entry, so one step back is the page before the click.
    await page.goBack();
    await expect(page).not.toHaveURL(/harness=/u);
    await expect(selected(page)).toContainText("latest");
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the harness inspector", () => {
  test("opens the diff with the previous version and each file in the inspector, and back closes each", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const { b, e } = served.fixture.harnesses;
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    await detail(page).getByRole("button", { name: "Compare with previous" }).click();
    expect(routeParameters(page)).toMatchObject({ harness: e, diff: b });
    await expect(inspector(page)).toHaveAttribute("aria-label", "Harness diff");
    await expect(inspector(page).locator(".ana-inspector-head strong")).toHaveText(
      `${named("C", b)} to ${named("F", e)}`,
    );
    await expect(inspector(page).locator(".ana-diff")).toBeVisible();
    await expect(inspector(page)).toBeFocused();
    expect(await accessibilityViolations(page, "main")).toEqual([]);
    expect(await accessibilityViolations(page, ".ana-inspector")).toEqual([]);
    await detail(page).getByRole("button", { name: "agent/BUILT_AGENTS.md" }).click();
    expect(routeParameters(page)).toMatchObject({ harness: e, file: "agent/BUILT_AGENTS.md" });
    expect(routeParameters(page).diff).toBeUndefined();
    await expect(inspector(page)).toHaveAttribute("aria-label", "Harness file");
    await expect(inspector(page).locator(".ana-file-content")).toContainText("# Guide");
    await expect(inspector(page).locator(".ana-file-links [aria-current='true']")).toHaveText(
      "agent/BUILT_AGENTS.md",
    );
    await inspector(page).getByRole("button", { name: "agent/tools-spec.json" }).click();
    await expect(inspector(page).locator(".ana-inspector-head strong")).toHaveText(
      `${named("F", e)} / agent/tools-spec.json`,
    );
    await expect(inspector(page).locator(".ana-record")).toBeVisible();
    expect(await accessibilityViolations(page, ".ana-inspector")).toEqual([]);
    // Each opening pushed an entry: back walks to the first file, the diff, then nothing open.
    await page.goBack();
    await expect(inspector(page).locator(".ana-inspector-head strong")).toHaveText(
      `${named("F", e)} / agent/BUILT_AGENTS.md`,
    );
    await page.goBack();
    await expect(inspector(page)).toHaveAttribute("aria-label", "Harness diff");
    await page.goBack();
    await expect(inspector(page)).toHaveCount(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("closes the inspector by its button and by Escape, and gives focus back", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const files = detail(page).getByRole("button", { name: "agent/tools-spec.json" });
    for (const action of ["button", "Escape"]) {
      await files.click();
      await expect(inspector(page).locator(".ana-record")).toBeVisible();
      if (action === "button") await inspector(page).getByRole("button", { name: "Close" }).click();
      else await page.keyboard.press("Escape");
      await expect(inspector(page)).toHaveCount(0);
      expect(routeParameters(page).file).toBeUndefined();
      await expect(files).toBeFocused();
    }
    // Closing pushed an entry of its own, which back undoes.
    await page.goBack();
    await expect(inspector(page)).toBeVisible();
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the harness strip on a phone", () => {
  test("scrolls sideways on a phone with the selected card in view and the page not wider than the screen", async () => {
    const opened = await openCampaign(PHONE.width);
    const { page } = opened;
    const list = strip(page);
    const widths = await list.evaluate((element) => [element.scrollWidth, element.clientWidth]);
    expect(widths[0]).toBeGreaterThan(widths[1] ?? 0);
    // The strip scrolled sideways to the selected card, the last, and the page did not move.
    await expect.poll(() => shownInStrip(page)).toBe(true);
    expect(await list.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await selected(page).focus();
    for (const _ of [1, 2, 3, 4, 5]) await page.keyboard.press("ArrowLeft");
    await expect(selected(page)).toContainText("Starter");
    await expect.poll(() => shownInStrip(page)).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("between two states", () => {
  test("choosing a card by click or arrow key never paints the strip's files empty or reading", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const { a, b } = served.fixture.harnesses;
    const files = detail(page).locator(".ana-harness-files .ana-evidence-link");
    const clicked = await watchFrames(
      page,
      STRIP_FILES,
      () => cardOf(page, "B", a).click(),
      () => expect(detail(page)).toContainText(short(a)),
    );
    await expect(files).toHaveCount(2);
    const walked = await watchFrames(
      page,
      STRIP_FILES,
      () => page.keyboard.press("ArrowRight"),
      () => expect(selected(page)).toContainText(short(b)),
    );
    await expect(files).toHaveCount(2);
    for (const frames of [clicked, walked]) {
      expect(frames).toMatchObject({ gone: 0, empty: 0, loading: 0 });
      expect(frames.frames).toBeGreaterThan(1);
    }
    expectQuiet(opened);
    await opened.context.close();
  });

  test("the inspector keeps what it shows until the next file or diff is read", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const head = inspector(page).locator(".ana-inspector-head strong");
    await detail(page).getByRole("button", { name: "Compare with previous" }).click();
    await expect(inspector(page).locator(".ana-diff")).toBeVisible();
    for (const [step, expected] of [
      [
        () => detail(page).getByRole("button", { name: "agent/BUILT_AGENTS.md" }).click(),
        / agent\/BUILT_AGENTS\.md$/u,
      ],
      [
        () => inspector(page).getByRole("button", { name: "agent/tools-spec.json" }).click(),
        / agent\/tools-spec\.json$/u,
      ],
      [() => detail(page).getByRole("button", { name: "Compare with previous" }).click(), / to /u],
    ] as const) {
      const frames = await watchFrames(page, INSPECTOR, step, async () => {
        await expect(head).toHaveText(expected);
        await expect(inspector(page).locator(INSPECTOR.content).first()).toBeVisible();
      });
      expect(frames).toMatchObject({ gone: 0, empty: 0, loading: 0 });
    }
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("between two slow reads", () => {
  test("a slow read leaves the previous file in place and says it is reading only after a moment", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const { e } = served.fixture.harnesses;
    await detail(page).getByRole("button", { name: "agent/BUILT_AGENTS.md" }).click();
    await expect(inspector(page).locator(".ana-file-content")).toContainText("# Guide");
    // The next file's answer is held until the test lets it go, as a server 1.5 s away would.
    const held = Promise.withResolvers<void>();
    await page.route(/\/api\/harness-file\?/u, async (route: Route) => {
      await held.promise;
      await route.continue();
    });
    const frames = await watchFrames(
      page,
      INSPECTOR,
      () => inspector(page).getByRole("button", { name: "agent/tools-spec.json" }).click(),
      async () => {
        await expect(
          inspector(page).getByText(`Reading ${named("F", e)} / agent/tools-spec.json.`),
        ).toBeVisible();
        await expect(inspector(page).locator(".ana-file-content")).toContainText("# Guide");
        await expect(inspector(page)).toHaveAttribute("aria-busy", "true");
      },
    );
    expect(frames).toMatchObject({ gone: 0, empty: 0 });
    expect(frames.firstLoadingMs ?? 0).toBeGreaterThanOrEqual(250);
    held.resolve();
    await expect(inspector(page).locator(".ana-record")).toBeVisible();
    await expect(inspector(page).getByText(/^Reading /u)).toHaveCount(0);
    await expect(inspector(page)).toHaveAttribute("aria-busy", "false");
    await page.unroute(/\/api\/harness-file\?/u);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("a slow diff leaves the open file in place, and the previous card's files stay while a card's are read", async () => {
    const opened = await openCampaign();
    const { page } = opened;
    const { b } = served.fixture.harnesses;
    await detail(page).getByRole("button", { name: "agent/BUILT_AGENTS.md" }).click();
    await expect(inspector(page).locator(".ana-file-content")).toContainText("# Guide");
    const held = Promise.withResolvers<void>();
    await page.route(/\/api\/harness(-diff)?\?/u, async (route: Route) => {
      await held.promise;
      await route.continue();
    });
    const diff = await watchFrames(
      page,
      INSPECTOR,
      () => detail(page).getByRole("button", { name: "Compare with previous" }).click(),
      () => expect(inspector(page).getByText(/^Reading .* to /u)).toBeVisible(),
    );
    expect(diff).toMatchObject({ gone: 0, empty: 0 });
    expect(diff.firstLoadingMs ?? 0).toBeGreaterThanOrEqual(250);
    await expect(inspector(page).locator(".ana-file-content")).toContainText("# Guide");
    const card = await watchFrames(
      page,
      STRIP_FILES,
      () => cardOf(page, "C", b).click(),
      () => expect(detail(page).getByText("Reading its files")).toBeVisible(),
    );
    expect(card).toMatchObject({ gone: 0, empty: 0 });
    expect(card.firstLoadingMs ?? 0).toBeGreaterThanOrEqual(250);
    await expect(detail(page).locator(".ana-harness-files")).toHaveAttribute("aria-busy", "true");
    held.resolve();
    await expect(detail(page).getByText("Reading its files")).toHaveCount(0);
    await expect(detail(page).locator(".ana-harness-files")).toHaveAttribute("aria-busy", "false");
    await page.unroute(/\/api\/harness(-diff)?\?/u);
    expectQuiet(opened);
    await opened.context.close();
  });
});
