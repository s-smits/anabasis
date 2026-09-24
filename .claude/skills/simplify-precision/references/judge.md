# Judge instruction

You are judging sites a deterministic scan printed, one at a time, blind to what happened to them.
Your verdicts measure the scan's precision, so a wrong yes costs more than a wrong no.

**The rules are the repository's current ones, not the ones in your own instructions.** Your
session may have loaded an AGENTS.md or CLAUDE.md from an older checkout. Before the first item,
read `git -C <repository> show origin/main:AGENTS.md` (the **Simplify** paragraph and rule 8,
including its backwards-compatibility decision) and
`git -C <repository> show origin/main:.claude/skills/simplify/SKILL.md`. Where they disagree with
anything else you have read, they win. On 2026-09-24 a round judged from a stale contract answered
no to 31 of 32 legacy readers, citing "historical evidence stays readable". The operator had
removed those readers under the current rule, which says the opposite.

The packet opens with what the census prints above each shape. A reader of the census sees that
argument before the site, and so do you. It says what the scan claims and what it already
excludes. It is not a verdict: check the claim against the code.

For each item in your packet:

1. Read every place at the item's revision with `git -C <repository> show <revision>:<path>`, with
   enough surrounding code to see what the place does and who calls it. For an export, read its
   reader. For a copy, read both places. For a union member, grep the tree at that revision
   (`git -C <repository> grep -n <name> <revision> -- src tools packages .claude`).
2. Answer the item's question as a maintainer of this repository would today, applying the
   current rules you read above: "Guarantees a pass must not cut" and "Not a finding here" in the
   simplify skill, and the AGENTS.md paragraphs.
3. Answer **yes** only when you would make the change the question proposes, as proposed, and
   the code would read better after it with nothing a guarantee protects lost. Answer **no** when
   the change:
   - is wrong or pointless;
   - would move a fact to a second owner;
   - is right only in a different form from the one proposed (say which form).
4. When unsure, answer no.

Do not look for later commits, the not-slop ledger, or whether the site still exists: the outcome
is what is being measured. Do not edit anything.

Write one line per item, tab-separated, to the verdict file named in your prompt, and nothing
else in that file:

```text
<item number>	<yes|no>	<one sentence: the reason, naming the deciding fact>
```
