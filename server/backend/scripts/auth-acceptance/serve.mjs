import http from 'node:http';
process.env.DATABASE_URL='postgresql://auth_test@127.0.0.1:4927/changmen_auth_acceptance';
process.env.DATABASE_URL_INTERNAL=process.env.DATABASE_URL; process.env.DATABASE_URL_PUBLIC=process.env.DATABASE_URL; process.env.DATABASE_SSL='0';
process.env.PM_MAINTENANCE_WATCH='0'; process.env.NODE_ENV='test'; process.env.JWT_SECRET='isolated-auth-acceptance-jwt-key-20261003';
process.env.WEB_AUTH_COOKIE_ENABLED='1'; process.env.AUTH_MODE='dual';
process.env.WEB_AUTH_CSRF_SECRET='isolated-auth-acceptance-csrf-key-20261003';
process.env.WEB_AUTH_ORIGINS='http://127.0.0.1:4931'; process.env.CORS_ALLOWED_ORIGINS=process.env.WEB_AUTH_ORIGINS;
process.env.CHANGMEN_CERT_LOGIN_BIND='0'; process.env.CHANGMEN_STORAGE_DIR=process.cwd()+'/output/auth-acceptance-storage';
const {getPgPool}=await import('@changmen/db'); const pool=getPgPool();
const target=await pool.query('SELECT current_database() AS name, inet_server_addr()::text AS host');
if(target.rows[0].name!=='changmen_auth_acceptance'||target.rows[0].host!=='127.0.0.1')throw new Error('Refusing to write outside the isolated acceptance database');
for(const name of ['river','acceptance-long']) {
 const u=await pool.query(`INSERT INTO users(user_name,password_hash,created_at,updated_at) VALUES($1,crypt('Acceptance-Only-2026!',gen_salt('bf',12)),$2,$2) ON CONFLICT(user_name) DO UPDATE SET password_hash=excluded.password_hash RETURNING id`,[name,Date.now()]);
 await pool.query(`INSERT INTO profiles(id,user_name,created_at,updated_at) VALUES($1,$2,$3,$3) ON CONFLICT(id) DO NOTHING`,[u.rows[0].id,name,Date.now()]);
}
await pool.query(`INSERT INTO client_matches(merge_key,title,game,game_id,start_time,bo,round,built_at,matchs,bets) VALUES('auth-acceptance','Auth Acceptance Alpha vs Beta','CS2','csgo',$1,3,0,$2,'{}','[]') ON CONFLICT(merge_key) WHERE merge_key IS NOT NULL DO UPDATE SET start_time=excluded.start_time,built_at=excluded.built_at`,[Date.now()+3600000,Date.now()]);
const {createHttpHandler}=await import('../../http_routes.js');
const {attachChangmenRealtimeHub}=await import('@changmen/realtime-hub');
const {authenticateRealtime,authorizeRealtime}=await import('../../core/auth/realtime_auth.js');
const handler=createHttpHandler({port:4930,serveStatic:(_req,res)=>{res.writeHead(404);res.end();}});
const server=http.createServer(handler);
attachChangmenRealtimeHub(server,{authenticate:authenticateRealtime,authorize:authorizeRealtime});
server.listen(4930,'127.0.0.1',()=>console.log('AUTH_ACCEPTANCE_READY 4930'));
