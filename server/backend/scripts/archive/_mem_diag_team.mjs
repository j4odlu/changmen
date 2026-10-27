#!/usr/bin/env node
import { loadAndCreatePlugin } from "@changmen/team-resolver/team_db";

const b = process.memoryUsage();
await loadAndCreatePlugin();
const a = process.memoryUsage();
console.log(JSON.stringify({
  heapUsedMb: Math.round(a.heapUsed / 1048576),
  heapDeltaMb: Math.round((a.heapUsed - b.heapUsed) / 1048576),
  rssMb: Math.round(a.rss / 1048576),
  rssDeltaMb: Math.round((a.rss - b.rss) / 1048576),
  externalMb: Math.round(a.external / 1048576),
}, null, 2));
