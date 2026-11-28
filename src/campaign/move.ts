export type Ending =
  | "budget"
  | "stop"
  | "exam"
  | "no-room"
  | "environment"
  | "operator"
  | "control"
  | "revise"
  | "finished";

export type ScheduledAction = (
  | { readonly move: "draft"; readonly why: string }
  | { readonly move: "accept"; readonly why: string }
  | { readonly move: "prepare"; readonly why: string }
  | { readonly move: "examine"; readonly why: string; readonly answers?: readonly number[] }
  | { readonly move: "build"; readonly why: string }
  | {
      readonly move: "compare";
      readonly why: string;
      readonly fresh: string;
      readonly reference: string;
      readonly id?: string;
    }
  | { readonly move: "promote"; readonly why: string; readonly harness: string }
  | { readonly move: "revert"; readonly why: string; readonly harness: string }
  | {
      readonly move: "end";
      readonly why: string;
      readonly ending: Ending;
      readonly answers?: readonly number[];
    }
) & {
  readonly code: string;
};

export const short = (digest: string): string => digest.slice(0, 8);

export function decidedLine(decided: ScheduledAction): string {
  const named = (harness: string) =>
    harness.length > 16
      ? short(harness)
      : harness === "starter"
        ? "the Starter Pack"
        : `the ${harness} harness`;
  const what = (): string => {
    switch (decided.move) {
      case "draft": {
        return "Examiner drafts the exam";
      }
      case "accept": {
        return "audit the exam checker";
      }
      case "prepare": {
        return "prepare and release practice tasks";
      }
      case "examine": {
        return "wake Examiner";
      }
      case "build": {
        return "run Builder";
      }
      case "compare": {
        return `compare ${named(decided.fresh)} against ${named(decided.reference)}`;
      }
      case "promote": {
        return `promote harness ${short(decided.harness)}`;
      }
      case "revert": {
        return `revert reference to ${named(decided.harness)}`;
      }
      case "end": {
        return `campaign ends (${decided.ending})`;
      }
    }
  };
  return `${what()}: ${decided.why}`;
}
