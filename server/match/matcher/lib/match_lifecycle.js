/** [changmen 扩展] 结束改变生命周期，保留比赛和原平台场次的归属。 */
export function isEndedClientMatch(row) {
  const ended = row?.ended_at ?? row?.endedAt;
  return ended != null && ended !== "";
}

export function buildEndedSourceOwners(clientRows) {
  const owners = new Map();
  const activeSources = new Set();
  for (const row of clientRows || []) {
    const id = Number(row.id ?? row.ID);
    if (!Number.isFinite(id) || id <= 0) continue;
    for (const [platform, sourceId] of Object.entries(row.matchs ?? row.Matchs ?? {})) {
      if (sourceId == null || sourceId === "") continue;
      const key = `${platform}:${sourceId}`;
      if (isEndedClientMatch(row)) owners.set(key, id);
      else activeSources.add(key);
    }
  }
  // 显式恢复或纠正归属后的活跃记录优先于重复历史记录。
  for (const key of activeSources) owners.delete(key);
  return owners;
}

/** 仅生成匹配用视图，原快照和关联指针不变；恢复 ended_at 后来源自然重新可用。 */
export function matchingPlatformSources(matches, clientRows) {
  const owners = buildEndedSourceOwners(clientRows);
  const endedIds = new Set((clientRows || []).filter(isEndedClientMatch).map(row => Number(row.id ?? row.ID)));
  const activeIds = new Set((clientRows || []).filter(row => !isEndedClientMatch(row)).map(row => Number(row.id ?? row.ID)));
  return Object.fromEntries(Object.entries(matches || {}).map(([platform, byId]) => [platform,
    Object.fromEntries(Object.entries(byId || {}).filter(([key, row]) => {
      const sourceId = row.SourceMatchID ?? row.source_match_id ?? key;
      const boundId = row.ClientMatchId ?? row.client_match_id ?? row.match_id;
      if (boundId != null && activeIds.has(Number(boundId))) return true;
      return !owners.has(`${platform}:${sourceId}`) && !endedIds.has(Number(boundId));
    })),
  ]));
}
