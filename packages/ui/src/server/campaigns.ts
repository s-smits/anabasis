/**
 * `GET /api/campaigns`: every campaign the server finds (`logs.ts`), one row each, newest first.
 *
 * The project is the one the campaign's opening names, or `NO_PROJECT` (`reading.ts`). Running is a
 * process that writes the log (`writers`,
 * `tools/runs/pulse.ts`). Newest first is by the time of a log's first event. A log that cannot be
 * read is an issue beside the rows, never a missing row without a word.
 */
import type { CampaignList, CampaignRow, Issue, Query } from "../models.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import type { Reading } from "./context.ts";
import { campaignsFound, loaded, sourceOf, writing } from "./logs.ts";
import { campaignRow } from "./reading.ts";

export function campaignsAnswer(reading: Reading, _query: Query<"campaigns">): CampaignList {
  const { found, issues: listed } = campaignsFound(reading);
  const issues: Issue[] = [...listed];
  let unlisted = false;
  const rows = found.flatMap((each): { readonly row: CampaignRow; readonly opened: string }[] => {
    const { log, issues: read } = loaded(each);
    issues.push(...read);
    if (log === null) return [];
    const process = writing(each);
    unlisted ||= process === null;
    try {
      return [
        { row: campaignRow(each, log, { process, tier: reading.tier }), opened: log.events[0]?.at ?? "" },
      ];
    } catch (error) {
      issues.push({ level: "error", source: sourceOf(each), message: errorMessage(error) });
      return [];
    }
  });
  if (unlisted) {
    issues.push({
      level: "warning",
      source: "ps, lsof",
      message: "the host's processes could not be listed, so no campaign reads as running",
    });
  }
  return {
    tier: reading.tier,
    issues,
    campaigns: rows.toSorted((one, other) => other.opened.localeCompare(one.opened)).map(({ row }) => row),
  };
}
