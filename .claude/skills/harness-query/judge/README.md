# Judge backends for harness-query

`harness-query` invokes an already-built Built Harness. By default it runs with no reviewer
(`judge: "off"`). This folder holds the choice, one file per backend, selected by a flag:

| `--judge` | file | what reviews the artifacts | spend |
| --- | --- | --- | --- |
| `off` (default) | `judge-option.mts` | nothing; the battery records `judge:"off"` | none |
| `configured` | `configured-judge.mts` | the repository's own review slot — `.harness/backends/<slug>.json` over `default.json` over `HARNESS_REVIEW_BACKEND` | that account's credential |

```sh
bun .claude/skills/harness-query/scripts/harness-query.mts \
  --harness domains/<slug> --task <taskId> --judge configured
```

`--judge-model <slug>` and `--judge-effort <level>` name the reviewer; with `configured` they are
applied as the resolver's own named pins (`REVIEW_MODEL`, `<KIND>_REVIEW_REASONING_EFFORT`),
because operator files may not carry a model.

`configured` returns measureHarness's "resolve the configured slot" state, so the census session
is opened by the same `judgeSessionFor` call a real battery makes. Run harness-query from the tree under test, so the judge and the measurement resolve out of
one checkout.

## What these verdicts are worth

The Judge is advisory everywhere in this system: it cannot change a verdict, a pass, a claim or an
adoption, and harness-query writes none of those.
