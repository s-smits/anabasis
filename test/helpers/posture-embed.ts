/** An embedder for `tools/wri/embed.ts` that needs no model: each text a unit vector from its digest,
 *  so one text always gets one vector and two texts differ. */
import { sha256 } from "#src/meta/digest.ts";

export const fakeEmbed = async (texts: readonly string[]): Promise<readonly Float32Array[]> =>
  texts.map((words) => {
    const raw = Float32Array.from(sha256(words).slice(0, 32), (digit) => Number.parseInt(digit, 16) - 7.5);
    const length = Math.hypot(...raw);
    return raw.map((value) => value / length);
  });
