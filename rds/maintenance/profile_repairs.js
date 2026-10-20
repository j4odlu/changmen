// [changmen 扩展] Bounded persistence operations; CLI planning and cache refresh stay in backend.
import { ensurePgPoolReady, getPgPool } from "../pg_pool.js";

export async function openProfileRepairData() {
  await ensurePgPoolReady();
  const pool = getPgPool();
  return {
    readRiverProfile() {
      return pool.query(`SELECT p.id, p.accounts FROM profiles p JOIN users u ON u.id = p.id WHERE u.user_name ILIKE 'River'`);
    },
    writeProfileAccounts(ownerId, accountsJson, updatedAt) {
      return pool.query(`UPDATE profiles SET accounts = $2::jsonb, updated_at = $3 WHERE id = $1`, [ownerId, accountsJson, updatedAt]);
    },
    readRiverOwner() {
      return pool.query(`SELECT p.id FROM profiles p JOIN users u ON u.id = p.id WHERE u.user_name ILIKE 'River'`);
    },
    readActivePlayers(ownerId) {
      return pool.query(`SELECT id, platform_name, player_name, provider
   FROM players WHERE owner_user_id = $1::uuid AND deleted_at IS NULL ORDER BY id`, [ownerId]);
    },
    softDeletePlayers(deletedAt, description, ownerId, playerIds) {
      return pool.query(`UPDATE players
   SET deleted_at = $1, delete_description = $2, updated_at = $1
   WHERE owner_user_id = $3::uuid AND deleted_at IS NULL AND id = ANY($4::bigint[])`, [deletedAt, description, ownerId, playerIds]);
    },
    readUserId(userName) {
      return pool.query(`SELECT id FROM users WHERE user_name ILIKE $1`, [userName]);
    },
    readProfileAccounts(userName) {
      return pool.query(`SELECT accounts FROM profiles p JOIN users u ON u.id = p.id WHERE u.user_name ILIKE $1`, [userName]);
    },
    readActivePlayer(playerId) {
      return pool.query(`SELECT id, platform_id, platform_name, player_name FROM players WHERE id = $1 AND deleted_at IS NULL`, [playerId]);
    },
    readPlayerOwner(playerId) {
      return pool.query(`SELECT owner_user_id FROM players WHERE id = $1`, [playerId]);
    },
    close() {
      return pool.end();
    },
  };
}
