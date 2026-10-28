import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect } from "./browser.ts";

/*
 * What the browser tests of the Tasks and Log panes watch beyond one assertion: the frames a page
 * paints while it reads (`watchFrames`), and the keyboard's way through a pane (`tabTo`).
 *
 * The page put a placeholder in the place of a table or a grid for the frames a read took, on every
 * click (14 October); a web-first assertion waits past such a frame and never sees it. So a loop of
 * animation frames, installed before the page's own script, counts each frame in which the region
 * watched is gone, empty, or says it is reading, from the moment a test arms it.
 *
 * When the page first said it was reading is read off the document as well as off a frame: on
 * 19 October, on a host at a load of 13.3 on 8 cores, the browser painted no frame in the second
 * and a half the Tasks pane was busy, and a test that had just seen `aria-busy` read it as never
 * said (`busyAfter` -1).
 */

/** What the frame loop counts, kept on the page's window. */
interface Frames {
  armedAt: number;
  frames: number;
  bad: number;
  readonly seen: string[];
  busyAfter: number;
}

declare global {
  interface Window {
    anaWatchedFrames?: Frames;
    anaWatchedMutations?: string[];
  }
}

/**
 * Frames watched from the page's first: from `arm` on, each animation frame in which none of
 * `regions` is visible with text, or in which the main region shows a placeholder that says it is
 * reading (`NoSignal`, or a faint line there or in the inspector), is counted bad;
 * and when `busy` first matched, in a frame or in a change to the document, as milliseconds after
 * arming.
 */
export async function watchFrames(
  context: BrowserContext,
  regions: readonly string[],
  busy: string,
): Promise<void> {
  await context.addInitScript(
    ({ watched, marked }) => {
      const state: Frames = { armedAt: -1, frames: 0, bad: 0, seen: [], busyAfter: -1 };
      window.anaWatchedFrames = state;
      const shown = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        return node?.checkVisibility() === true && node.innerText.trim() !== "";
      };
      const markBusy = (now: number) => {
        if (state.armedAt >= 0 && state.busyAfter < 0 && document.querySelector(marked) !== null) {
          state.busyAfter = now - state.armedAt;
        }
      };
      new MutationObserver(() => {
        markBusy(performance.now());
      }).observe(document, { subtree: true, childList: true, attributes: true });
      const tick = (now: number) => {
        markBusy(now);
        if (state.armedAt >= 0) {
          state.frames += 1;
          const said = [
            ...document.querySelectorAll<HTMLElement>(
              "main .ana-nosignal, main p.ana-faint, aside p.ana-faint",
            ),
          ]
            .flatMap((node) => (node.checkVisibility() ? [node.innerText] : []))
            .join(" ");
          const placeholder = /Reading the |is loading/u.exec(said);
          if (!watched.some(shown) || placeholder !== null) {
            state.bad += 1;
            if (state.seen.length < 5) state.seen.push(placeholder?.[0] ?? "empty");
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { watched: regions, marked: busy },
  );
}

/** Start counting frames from the next one. */
export async function arm(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.anaWatchedFrames !== undefined) window.anaWatchedFrames.armedAt = performance.now();
  });
  // At least one frame is counted before the test acts.
  await expect.poll(() => framesOf(page).then((frames) => frames.frames)).toBeGreaterThan(0);
}

/** What the frames watched since `arm` came to. */
export async function framesOf(page: Page): Promise<Frames> {
  const frames = await page.evaluate(() => window.anaWatchedFrames);
  if (frames === undefined) throw new Error("no frames watched: call watchFrames before the page loads");
  return frames;
}

/** Record every change under the element `target` finds, from now on (`mutationsOf`). */
export async function watchMutations(target: Locator): Promise<void> {
  await target.evaluate((node) => {
    const seen: string[] = [];
    window.anaWatchedMutations = seen;
    new MutationObserver((records) => {
      for (const record of records) seen.push(`${record.type} ${record.target.nodeName}`);
    }).observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}

/** The changes `watchMutations` recorded, once a frame has followed the last one. */
export async function mutationsOf(page: Page): Promise<string[]> {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(resolve);
      }),
  );
  return page.evaluate(() => window.anaWatchedMutations ?? ["not watched"]);
}

/** Press Tab until `target` has the focus, at most `limit` times. */
export async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  for (let pressed = 0; pressed < limit; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab did not reach the target in ${String(limit)} presses`);
}

/** The focused element draws a ring a person can see. */
export async function expectFocusRing(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const ring = await target.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      outline: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      shadow: style.boxShadow,
    };
  });
  expect((ring.outline !== "none" && ring.width > 0) || ring.shadow !== "none").toBe(true);
}
