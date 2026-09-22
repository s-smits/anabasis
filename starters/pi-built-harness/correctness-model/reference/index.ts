import type { ReferenceSolveFn } from "@ana/correctness-model-bundle";

/** Build a correct artifact from public inputs. Helpers stay in this reference package;
 * the solve must not import private evaluation data, tasks or controls. */
export const solve: ReferenceSolveFn = () =>
  Promise.reject(new Error("Specialise the Pi Starter Pack public reference solve."));
