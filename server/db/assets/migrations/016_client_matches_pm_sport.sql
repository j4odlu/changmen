-- Polymarket Sports WS 赛程快照（VPS polymarket-sports 守护进程写入；matcher 不覆盖）

ALTER TABLE client_matches
  ADD COLUMN IF NOT EXISTS pm_sport jsonb;

COMMENT ON COLUMN client_matches.pm_sport IS
  'Polymarket Sports WS 快照：status/score/period/maps/ended 等；由 VPS 守护进程 UPDATE';

ALTER TABLE client_matches_history
  ADD COLUMN IF NOT EXISTS pm_sport jsonb;
