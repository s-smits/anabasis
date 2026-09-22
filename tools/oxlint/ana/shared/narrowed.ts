/**
 * Whether a function has already tested a dotted path, which is TypeScript narrowing written
 * down.
 *
 * Two rules ask a file to drop a name, and both are wrong wherever the narrowing is what the
 * name carries. `no-argument-already-carried` would have the callee read `message.fakeResponses`
 * off the `message` beside it, but the call sits in the arm where that field is not `undefined`
 * and the callee would have to redo the test. `no-renaming-temporary` would inline
 * `const key = options.apiKey` into the closure below it, where the guard three lines up does
 * not reach and the field is `string | undefined` again.
 *
 * The test is textual, over the enclosing function's source, and deliberately loose: a narrowing
 * of a prefix narrows the path too, so `declarator.id.type === "Identifier"` answers for
 * `declarator.id.name`. Loose is the safe direction here, because a missed narrowing is a
 * finding a reader cannot act on.
 */

/** Every dotted prefix of a path, longest first: `a.b.c` gives `a.b.c` and `a.b`, never `a`. */
export function prefixes(path: string): string[] {
  const dots: number[] = [];
  for (let at = path.indexOf(".", path.indexOf(".") + 1); at > 0; at = path.indexOf(".", at + 1)) {
    dots.push(at);
  }
  return [path, ...dots.toReversed().map((at) => path.slice(0, at))];
}

/** A path in a comparison, a `typeof` or an `instanceof`, which is how this tree narrows. */
function testedIn(text: string, path: string): boolean {
  const escaped = path.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  return (
    new RegExp(`${escaped}\\b[^\\n]{0,40}?(?:===|!==|instanceof )`, "u").test(text) ||
    text.includes(`typeof ${path}`)
  );
}

/** Whether this text narrows the path itself or any dotted prefix of it. */
export function narrowedIn(text: string, path: string): boolean {
  return prefixes(path).some((prefix) => testedIn(text, prefix));
}
