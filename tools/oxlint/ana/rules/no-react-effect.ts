import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isOneOf, isTestFile } from "../shared/file-role.ts";

/**
 * Disallows `useEffect`, `useLayoutEffect`, and `useInsertionEffect` outside
 * `packages/ui/src/mount.ts` (`useMountEffect`) and test files: derive values during render, reset
 * state with `key`, handle user actions in event handlers, attach nodes via callback refs, or
 * subscribe via `useSyncExternalStore`. There is no fix.
 */

/** The one file that may call an effect: the owner of `useMountEffect`. */
const EFFECT_OWNERS = ["packages/ui/src/mount.ts"];

const EFFECTS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

function effectCalled(callee: ESTree.Expression): string | null {
  if (callee.type === "Identifier") return EFFECTS.has(callee.name) ? callee.name : null;
  if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return null;
  return EFFECTS.has(callee.property.name) ? callee.property.name : null;
}

export const noReactEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "No React effect: render, key, handler, callback ref or external store.",
      examples: [
        {
          before:
            "export function Count({ rows }: Props) {\n  const [count, setCount] = useState(0);\n  useEffect(() => setCount(rows.length), [rows]);\n  return <span>{count}</span>;\n}",
          after: "export function Count({ rows }: Props) {\n  return <span>{rows.length}</span>;\n}",
          path: "packages/ui/src/views/count.tsx",
        },
        {
          before:
            "export function Picker({ onPick }: Props) {\n  const [choice, setChoice] = useState<string | null>(null);\n  useEffect(() => { if (choice !== null) onPick(choice); }, [choice]);\n  return <List onSelect={setChoice} />;\n}",
          after: "export function Picker({ onPick }: Props) {\n  return <List onSelect={onPick} />;\n}",
          path: "packages/ui/src/views/picker.tsx",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      effect:
        "`{{hook}}` draws its result one frame late. Derive the value during render, reset with `key`, act in the event handler, use a callback ref, hold the external system as a store read through `useSyncExternalStore`, or act once as a keyed component mounts through `useMountEffect` (packages/ui/src/mount.ts).",
    },
  },
  createOnce(context) {
    return {
      before: () => !isTestFile(context.filename) && !isOneOf(context.filename, EFFECT_OWNERS),

      CallExpression(node) {
        const hook = effectCalled(node.callee);
        if (hook !== null) context.report({ node, messageId: "effect", data: { hook } });
      },
    };
  },
});
