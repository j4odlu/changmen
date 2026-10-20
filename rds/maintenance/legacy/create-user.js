#!/usr/bin/env node

/**
 * 创建系统登录用户（RDS users + JWT）
 * 用法：
 *   node scripts/create-user.js <用户名> <密码>
 *   node scripts/create-user.js --admin <用户名> <密码>
 */

import crypto from "node:crypto";
import {
  buildPgClientConfig,
  initDatabaseUrl,
  insertProfile,
} from "@changmen/db";
import pg from "@changmen/db/pg.js";

async function createJwtUser(userName, password, asAdmin = false) {
  await initDatabaseUrl();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("缺少 DATABASE_URL，请在 server/backend/.env 配置 DATABASE_URL_PUBLIC/INTERNAL");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    console.error("缺少 JWT_SECRET（至少 16 字符）");
    process.exit(1);
  }

  const name = String(userName).trim();
  const now = Date.now();
  const client = new pg.Client(buildPgClientConfig(url));
  await client.connect();

  try {
    const existing = await client.query(
      "SELECT id FROM users WHERE lower(user_name) = lower($1)",
      [name],
    );
    const userId = existing.rows[0]?.id || crypto.randomUUID();

    await client.query(
      `INSERT INTO users (id, user_name, password_hash, metadata, is_admin, created_at, updated_at)
       VALUES ($1, $2, crypt($3, gen_salt('bf', 12)), '{}', $4, $5, $5)
       ON CONFLICT (user_name) DO UPDATE SET
         password_hash = crypt($3, gen_salt('bf', 12)),
         is_admin = EXCLUDED.is_admin OR users.is_admin,
         updated_at = EXCLUDED.updated_at`,
      [userId, name, password, Boolean(asAdmin), now],
    );

    const ok = await insertProfile(userId, {
      id: userId,
      user_name: name,
      accounts: [],
      betting_config: {},
      collect_config: {},
      preferences: {},
      created_at: now,
      updated_at: now,
    });
    if (!ok) {
      console.error("users 已写入，但 profiles 插入失败");
      process.exit(1);
    }

    console.log(
      "成功:",
      JSON.stringify({ id: userId, userName: name, auth: "jwt", isAdmin: Boolean(asAdmin) }, null, 2),
    );
  }
  finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asAdmin = args[0] === "--admin";
  const [userName, password] = asAdmin ? args.slice(1) : args;

  if (!userName || !password) {
    console.error("用法: node scripts/create-user.js [--admin] <用户名> <密码>");
    process.exit(1);
  }

  console.log(`创建用户 (JWT/RDS)${asAdmin ? " [管理员]" : ""}: ${userName}`);
  await createJwtUser(userName, password, asAdmin);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
