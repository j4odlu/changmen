-- platform_matches.rot_num：PB euro/odds event.rotNum（对阵归组键；非下注主键）
-- [changmen 扩展] SourceMatchID 仍为 event.id；合场认场后续可按 rot_num 聚类

ALTER TABLE platform_matches
  ADD COLUMN IF NOT EXISTS rot_num text;

ALTER TABLE platform_matches_history
  ADD COLUMN IF NOT EXISTS rot_num text;

COMMENT ON COLUMN platform_matches.rot_num IS
  '馆方对阵归组键；PB=euro/odds rotNum。可空；非 SourceMatchID';

CREATE INDEX IF NOT EXISTS platform_matches_platform_rot_num
  ON platform_matches(platform, rot_num)
  WHERE rot_num IS NOT NULL;
