import { describe, expect, it } from "vitest";
import {
  ARCHIVE_SCOPE_ALL,
  ARCHIVE_SCOPE_CLIENT,
  ARCHIVE_SCOPE_LEGACY_PLATFORM,
  resolveArchiveSpecs,
} from "./archive_stale.js";

describe("resolveArchiveSpecs", () => {
  it("client scope is no-op (ended_at lifecycle; no built_at move)", () => {
    const { deleteSpecs, archiveSpecs } = resolveArchiveSpecs(ARCHIVE_SCOPE_CLIENT);
    expect(deleteSpecs).toHaveLength(0);
    expect(archiveSpecs).toHaveLength(0);
  });

  it("legacy-platform scope archives platform tables only", () => {
    const { deleteSpecs, archiveSpecs } = resolveArchiveSpecs(ARCHIVE_SCOPE_LEGACY_PLATFORM);
    expect(deleteSpecs.map(s => s.key).sort()).toEqual(["live_timers", "platform_bets"]);
    expect(archiveSpecs.map(s => s.key)).toEqual(["platform_matches"]);
  });

  it("all scope includes ended client cold-move and platform", () => {
    const { deleteSpecs, archiveSpecs } = resolveArchiveSpecs(ARCHIVE_SCOPE_ALL);
    expect(deleteSpecs).toHaveLength(2);
    expect(archiveSpecs.map(s => s.key).sort()).toEqual(["client_matches", "platform_matches"]);
    const clientSpec = archiveSpecs.find(s => s.key === "client_matches");
    expect(clientSpec.whereExtra).toMatch(/ended_at/);
  });
});
