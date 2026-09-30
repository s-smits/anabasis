/** One duty, one owner, across every surface a Builder reads. The system prompt owns each duty it
 *  states, and a sentence another surface renders at its own moment (the kickoff, the round prompt,
 *  the battery contract, the readout, the sizing sentence) names that duty's trigger without saying
 *  it again. The measure is the share of a pair's words of four letters or more that both sentences
 *  use, over the shorter sentence's count; a restatement reads at 0.55 or above. On 2026-09-30 the
 *  round prompt's raise and the no-limit line each defined depth again in the same 17 words, which a
 *  check inside the system prompt alone could not see. */

import { expect } from "bun:test";
import { builderSystemPrompt } from "../../src/author/builder-start-prompt.ts";

export const flat = (text: string) => text.replace(/\s+/g, " ");

/** The sentences of `text` long enough to carry a duty. */
export const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.:])\s+/)
    .map(flat)
    .filter((line) => line.length > 40);

const words = (line: string) => new Set(line.toLowerCase().match(/[a-z]{4,}/g) ?? []);

export function overlap(left: string, right: string): number {
  const [a, b] = [words(left), words(right)];
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}

export const SYSTEM_SENTENCES = sentencesOf(builderSystemPrompt(true));

/** Fails on any sentence of `text` that restates one the system prompt already carries. */
export function expectNoRestatedDuty(text: string): void {
  for (const line of sentencesOf(text)) {
    for (const sentence of SYSTEM_SENTENCES) {
      expect(overlap(line, sentence), `${line}\n~~\n${sentence}`).toBeLessThan(0.55);
    }
  }
}
