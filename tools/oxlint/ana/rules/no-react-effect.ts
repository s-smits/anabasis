import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isOneOf, isTestFile } from "../shared/file-role.ts";

/**
 * A React effect runs after the frame it belongs to has painted, so whatever it sets is drawn one
 * frame late, and whatever it reads is the last render's. On 14 October the browser tests of the
 * operator's page (`packages/ui/test/browser-*.test.ts`) counted that cost in frames: a choice of
 * harness card, a file opened in the inspector and a campaign picked each painted a loading line
 * for one to four frames, because an effect noticed the change after it had drawn and set the
 * placeholder in its place; closing the inspector left focus on the page's body, because an effect
 * that StrictMode ran twice took the inspector itself for where focus had come from. The page held
 * nineteen effects in nine files, and each was code asking after the fact what an event handler,
 * the render, a `key`, a callback ref or a subscription already knew at the time.
 *
 * The rule is the operator's of that day, after github.com/alejandrobailo/no-use-effect: no
 * `useEffect`, `useLayoutEffect` or `useInsertionEffect`, in a component or in a hook. Derive the
 * value during render; reset a subtree with `key`; do what a person caused in the handler of what
 * they did; act on a node as it attaches through a callback ref; hold an external system, a request
 * in flight, a timer or a listener on the document, as a store read through `useSyncExternalStore`,
 * whose subscription begins and ends with what it reads; and act once on the world as a component
 * mounts through `useMountEffect`, mounting the component where the act is due and keying it by
 * what it acts on. That hook is the one effect, and its file (`packages/ui/src/mount.ts`) the one
 * place the rule admits.
 *
 * The rule reads the call, whatever it is imported as: a bare `useEffect(…)` and
 * `React.useEffect(…)` alike. Tests are exempt: a test that renders a component may need to
 * observe it as React does.
 *
 * There is no fix. Each site has three or four correct answers, and which one it wants is the
 * reading of what the effect was for.
 */

/** The one file that may call an effect: the owner of `useMountEffect`. */
const EFFECT_OWNERS = ["packages/ui/src/mount.ts"];

/** The three hooks that run code after React has committed a render. */
const EFFECTS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

/** The effect hook a call names, bare or off a namespace, or null for any other call. */
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
