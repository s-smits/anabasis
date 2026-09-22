import type { CheckFn } from "@ana/correctness-model-bundle";

/** Replace the placeholder with one Boolean function for every brief truth-check id. */
export const checks = {
  "replace-with-declared-check": () => {
    throw new Error("Specialise the Pi Starter Pack verifier.");
  },
} satisfies Record<string, CheckFn>;
