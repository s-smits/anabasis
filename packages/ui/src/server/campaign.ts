/**
 * `GET /api/campaign?key=`: one campaign's reading, which the Campaign pane draws whole and the
 * other panes take their headers from (`reading.ts`).
 */
import type { CampaignReading, Query } from "../models.ts";
import type { Reading } from "./context.ts";
import { campaignAt, writing } from "./logs.ts";
import { campaignReading, campaignRow } from "./reading.ts";

export function campaignAnswer(reading: Reading, query: Query<"campaign">): CampaignReading {
  const { found, log, issues } = campaignAt(reading, query.key);
  const row = campaignRow(found, log, { process: writing(found), tier: reading.tier });
  return campaignReading(found, log, { row, tier: reading.tier, issues });
}
