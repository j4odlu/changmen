import { describe, expect, it, vi } from "vitest";
import {
  listVenueWsStatuses,
  reportVenueWsStatus,
  resetVenueWsStatusesForTests,
  subscribeVenueWsStatus,
} from "@changmen/venue-browser/shared/venueWsStatus";

describe("venueWsStatus", () => {
  it("lists registered connections with default disconnected", () => {
    resetVenueWsStatusesForTests();
    const rows = listVenueWsStatuses();
    expect(rows.map(r => r.label)).toEqual(["PM-M", "PM-S", "PM-U", "LM", "PF", "DEX", "HUB", "PB", "OB-S"]);
    expect(rows.every(r => r.status === "disconnected")).toBe(true);
  });

  it("notifies subscribers on status change", () => {
    resetVenueWsStatusesForTests();
    const listener = vi.fn();
    subscribeVenueWsStatus(listener);
    reportVenueWsStatus("dex", "connected");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listVenueWsStatuses().find(r => r.id === "dex")?.status).toBe("connected");
  });
});
