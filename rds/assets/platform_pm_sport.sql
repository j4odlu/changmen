-- [changmen 扩展] PM 原生状态与平台场次同存；匹配关联仍由 match_id 表达。
ALTER TABLE platform_matches ADD COLUMN IF NOT EXISTS pm_sport jsonb;
