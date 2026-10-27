import { test } from "node:test";
import { runStorageFixture } from "./fixture.mjs";

test("default paths and root discovery retain the existing layout and fallback", t => runStorageFixture(t, `
const p=await import('@changmen/storage/paths');
assert.equal(p.CHANGMEN_ROOT,root); assert.equal(p.BACKEND_ROOT,path.join(root,'server/backend'));
assert.equal(p.STORAGE_DIR,path.join(root,'server/backend/storage')); assert.equal(p.ESPORT_DATA_DIR,p.STORAGE_DIR);
assert(fs.statSync(p.ESPORT_DATA_DIR).isDirectory());
assert.equal(p.changmenPath('one','two'),path.join(root,'one/two'));
assert.equal(p.findChangmenRoot(path.join(root,'deep/child')),root);
fs.mkdirSync(path.join(root,'deep/server/backend'),{recursive:true});
fs.writeFileSync(path.join(root,'deep/server/backend/package.json'),'{');
assert.equal(p.findChangmenRoot(path.join(root,'deep')),root);
const orphan=path.join(root,'orphan/a/b'); fs.mkdirSync(orphan,{recursive:true});
fs.renameSync(path.join(root,'server/backend/package.json'),path.join(root,'server/backend/marker.backup'));
assert.equal(p.findChangmenRoot(orphan),path.join(root,'orphan'));
`));

for (const [name, env, backend, storage, data] of [
  ['legacy overrides', { GAMEBET_BACKEND_ROOT: '{root}/legacy-backend', GAMEBET_STORAGE_DIR: '{root}/legacy-storage' }, 'legacy-backend', 'legacy-storage', 'legacy-storage'],
  ['canonical overrides', { CHANGMEN_BACKEND_ROOT: '{root}/backend', GAMEBET_BACKEND_ROOT: '{root}/legacy-backend', CHANGMEN_STORAGE_DIR: '{root}/storage', GAMEBET_STORAGE_DIR: '{root}/legacy-storage', ESPORT_DATA_DIR: '{root}/data' }, 'backend', 'storage', 'data'],
  ['empty overrides', { CHANGMEN_BACKEND_ROOT: '', GAMEBET_BACKEND_ROOT: '', CHANGMEN_STORAGE_DIR: '', GAMEBET_STORAGE_DIR: '', ESPORT_DATA_DIR: '' }, 'server/backend', 'server/backend/storage', 'server/backend/storage'],
]) test(`path precedence: ${name}`, t => runStorageFixture(t, `
const p=await import('@changmen/storage/paths');
assert.equal(p.BACKEND_ROOT,${backend.startsWith('server/') ? `path.join(root,${JSON.stringify(backend)})` : `root+${JSON.stringify('/'+backend)}`});
assert.equal(p.STORAGE_DIR,${storage.startsWith('server/') ? `path.join(root,${JSON.stringify(storage)})` : `root+${JSON.stringify('/'+storage)}`});
assert.equal(p.ESPORT_DATA_DIR,${data.startsWith('server/') ? `path.join(root,${JSON.stringify(data)})` : `root+${JSON.stringify('/'+data)}`});
assert(fs.statSync(p.ESPORT_DATA_DIR).isDirectory());
`, { env }));

test("environment loading preserves existing values and explicitly empty database alternatives", t => runStorageFixture(t, `
const {loadChangmenEnv}=await import('@changmen/storage/load_env'); loadChangmenEnv();
assert.equal(process.env.FIXTURE_VALUE,'shell'); assert.equal(process.env.FIXTURE_EMPTY,'from-file');
assert.equal(process.env.DATABASE_URL,'postgresql://fixture@127.0.0.1:1/fixture');
assert.equal(process.env.DATABASE_URL_PUBLIC,''); assert.equal(process.env.DATABASE_URL_INTERNAL,'');
`, {
  files: { 'server/backend/.env': 'FIXTURE_VALUE=file\nFIXTURE_EMPTY=from-file\nDATABASE_URL_PUBLIC=postgresql://never-use\nDATABASE_URL_INTERNAL=postgresql://never-use\n' },
  env: { FIXTURE_VALUE: 'shell', FIXTURE_EMPTY: '', DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/fixture' },
}));

test("prepend files stop loading once a database URL is available", t => runStorageFixture(t, `
delete process.env.DATABASE_URL; const {loadChangmenEnv}=await import('@changmen/storage/load_env');
loadChangmenEnv({prepend:['missing.env','server/match/matcher/.env']});
assert.equal(process.env.DATABASE_URL,'postgresql://prepend-fixture');
assert.equal(process.env.FIXTURE_PREPEND,'yes'); assert.equal(process.env.FIXTURE_BACKEND,undefined);
`, { files: {
  'server/match/matcher/.env': 'DATABASE_URL=postgresql://prepend-fixture\nFIXTURE_PREPEND=yes\n',
  'server/backend/.env': 'DATABASE_URL=postgresql://backend-fixture\nFIXTURE_BACKEND=yes\n',
} }));

test("prepend without a database URL continues to the backend file and retains first values", t => runStorageFixture(t, `
delete process.env.DATABASE_URL; const {loadChangmenEnv}=await import('@changmen/storage/load_env');
loadChangmenEnv({prepend:['server/match/matcher/.env']});
assert.equal(process.env.DATABASE_URL,'postgresql://backend-fixture');
assert.equal(process.env.FIXTURE_VALUE,'prepend'); assert.equal(process.env.FIXTURE_BACKEND,'yes');
`, { files: {
  'server/match/matcher/.env': 'FIXTURE_VALUE=prepend\n',
  'server/backend/.env': 'FIXTURE_VALUE=backend\nDATABASE_URL=postgresql://backend-fixture\nFIXTURE_BACKEND=yes\n',
} }));

test("an existing database URL still loads the first available file before stopping", t => runStorageFixture(t, `
const {loadChangmenEnv}=await import('@changmen/storage/load_env');
loadChangmenEnv({prepend:['server/match/matcher/.env']});
assert.equal(process.env.FIXTURE_PREPEND,'yes'); assert.equal(process.env.FIXTURE_BACKEND,undefined);
assert.equal(process.env.DATABASE_URL,'postgresql://shell-fixture');
`, { files: {
  'server/match/matcher/.env': 'FIXTURE_PREPEND=yes\n',
  'server/backend/.env': 'FIXTURE_BACKEND=yes\n',
}, env: { DATABASE_URL: 'postgresql://shell-fixture' } }));

test("development env file order, process overrides and cookie switch remain unchanged", t => runStorageFixture(t, `
const {readDevWebPort}=await import('@changmen/storage/dev_web_config');
assert.equal(readDevWebPort(undefined,{},'win32'),6100);
assert.equal(readDevWebPort(undefined,{VITE_DEV_PORT:'6200'},'win32'),6200);
const {cookieOnlyAuth}=await import('@changmen/storage/auth_mode');
assert.equal(cookieOnlyAuth(),false); process.env.AUTH_MODE=' COOKIE '; assert.equal(cookieOnlyAuth(),true);
process.env.AUTH_MODE='legacy'; assert.equal(cookieOnlyAuth(),false);
`, { files: {
  'client/web/.env': 'VITE_DEV_PORT=5274\n',
  'client/web/.env.local': 'VITE_DEV_PORT=5500\n',
  'client/web/.env.development': 'VITE_DEV_PORT=6000\n',
  'client/web/.env.development.local': 'VITE_DEV_PORT=6100\n',
} }));
