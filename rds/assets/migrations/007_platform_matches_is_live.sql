-- platform_matches.is_live：采集端 SaveMatch 写入（OB game/index：1=未开赛，2=进行中）
ALTER TABLE platform_matches
  ADD COLUMN IF NOT EXISTS is_live smallint;

COMMENT ON COLUMN platform_matches.is_live IS
  '平台 index 的 is_live；OB: 1=未开赛/赛后，2=进行中；matcher 构建活跃 client_matches 用';
