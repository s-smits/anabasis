/**
 * `GET /api/campaigns`: every campaign the server finds (`logs.ts`), one row each, newest first by
 * a log's first event. A log that cannot be read is an issue beside the rows. The list keeps each
 * log's facts (`factsIn`), never its events, at the log's stamp (`stampOf`), and forgets a log the
 * listing no longer finds.
 */
import type { CampaignList, CampaignRow, Issue, Query } from "../models.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import type { Reading } from "./context.ts";
import { campaignsFound, type Found, loaded, sourceOf, stampOf, writing } from "./logs.ts";
import { campaignRow, factsIn } from "./reading.ts";

interface Listed {
  readonly stamp: string | null;
  readonly facts: ReturnType<typeof factsIn> | null;
  readonly issues: readonly Issue[];
}

const listed = new Map<string, Listed>();

function factsOf(found: Found): { readonly read: boolean; readonly listing: Listed } {
  const stamp = stampOf(found);
  const was = listed.get(found.path);
  if (was !== undefined && stamp !== null && was.stamp === stamp) return { read: false, listing: was };
  const { log, issues } = loaded(found, "list");
  let listing: Listed;
  try {
    listing = { stamp, facts: log === null ? null : factsIn(log), issues };
  } catch (error) {
    listing = {
      stamp,
      facts: null,
      issues: [{ level: "error", source: sourceOf(found), message: errorMessage(error) }],
    };
  }
  listed.set(found.path, listing);
  return { read: true, listing };
}

/** Every log's facts, with a turn of the event loop after each log read again: a cold list reads
 *  gigabytes over seconds on the one thread, and between two logs the selected campaign, asked
 *  beside it, is answered at once. */
export async function readAll(reading: Pick<Reading, "repo" | "trees" | "now">): Promise<void> {
  for (const each of campaignsFound(reading).found) {
    if (factsOf(each).read) await Bun.sleep(0);
  }
}

export function campaignsAnswer(reading: Reading, _query: Query<"campaigns">): CampaignList {
  const { found, issues: looked } = campaignsFound(reading);
  const paths = new Set(found.map(({ path }) => path));
  for (const path of listed.keys()) if (!paths.has(path)) listed.delete(path);
  const issues: Issue[] = [...looked];
  let unlisted = false;
  const rows = found.flatMap((each): { readonly row: CampaignRow; readonly opened: string }[] => {
    const { facts, issues: read } = factsOf(each).listing;
    issues.push(...read);
    if (facts === null) return [];
    const process = writing(each);
    unlisted ||= process === null;
    return [{ row: campaignRow(each, facts, { process, tier: reading.tier }), opened: facts.opened }];
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
