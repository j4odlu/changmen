/** Keep migrated implementations and their compatibility exports in the same layer. */
export function venueManualChunk(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");
  if ([
    "packages/arb-core/", "@changmen/arb-core/",
    "packages/client-core/", "@changmen/client-core/",
    "packages/shared/", "@changmen/shared/",
    "packages/api-contract/", "@changmen/api-contract/",
  ].some(marker => normalized.includes(marker))) {
    return "venue-shared";
  }
  // socket.io is also used by the shared hub. Assigning it to a venue can cause TDZ errors.
  if (["socket.io-client", "engine.io-client", "socket.io-parser"]
    .some(pkg => normalized.includes(`/node_modules/${pkg}/`))) {
    return "venue-shared";
  }
  // Nested workspace dependencies must remain under Rollup's automatic assignment.
  if (normalized.includes("/node_modules/")) return undefined;

  const marker = "client/packages/venue-browser/";
  const index = normalized.indexOf(marker);
  if (index < 0) return undefined;
  const relative = normalized.slice(index + marker.length);
  if (relative.startsWith("shared/") || relative.startsWith("contract/"))
    return "venue-shared";
  if (relative.startsWith("polymarket/")) return "venue-polymarket";
  if (!relative.startsWith("adapter/")) return undefined;

  const dir = relative.slice("adapter/".length).split("/")[0];
  if (!dir || dir === "registry" || dir === "adaptation") return undefined;
  if (dir === "shared" || dir === "contract") return "venue-shared";
  return `venue-${dir}`;
}
