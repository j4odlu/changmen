import { X509Certificate, randomBytes } from 'node:crypto';
import { mkdtemp, chmod, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const run = (args, extra = {}) => exec(process.env.CERT_OPENSSL_BIN || 'openssl', args, { timeout: 30_000, maxBuffer: 1024 * 1024, ...extra });
export function issuerReady() {
  return ['CERT_ISSUER_CERT','CERT_ISSUER_KEY','CERT_ISSUER_CHAIN','CERT_CA_BUNDLE'].every(k => process.env[k] && existsSync(process.env[k]));
}
export function certificateMetadata(pem, userId, label = '') {
  if (!uuid.test(String(userId))) throw new Error('请选择有效用户');
  const cert = new X509Certificate(pem);
  if (cert.ca || !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.2')) throw new Error('需要客户端证书，不能登记 CA 或服务端证书');
  const cn = /^CN=(.+)$/m.exec(cert.subject)?.[1];
  if (!cn) throw new Error('证书缺少 CN');
  return { userId, label: String(label).slice(0,80), fingerprint: cert.fingerprint256.replace(/:/g,'').toLowerCase(),
    serial: cert.serialNumber, cn, pem: cert.toString(), notBefore: Date.parse(cert.validFrom), expiresAt: Date.parse(cert.validTo) };
}
export async function verifyManagedCertificate(pem) {
  if (!process.env.CERT_CA_BUNDLE) throw new Error('证书信任链未配置');
  const dir = await mkdtemp(path.join(tmpdir(),'changmen-cert-verify-')); await chmod(dir,0o700);
  try {
    const file = path.join(dir,'client.crt'); await writeFile(file,pem,{mode:0o600});
    await run(['verify','-purpose','sslclient','-CAfile',process.env.CERT_CA_BUNDLE,
      ...(process.env.CERT_ISSUER_CHAIN ? ['-untrusted',process.env.CERT_ISSUER_CHAIN] : []),file]);
  } catch { throw new Error('证书未通过信任链、用途或有效期验证'); }
  finally { await rm(dir,{recursive:true,force:true}); }
}
export async function issueManagedCertificate({ userId, password, days = 180, label }) {
  if (!issuerReady()) throw Object.assign(new Error('证书签发服务尚未配置'),{status:503});
  if (!uuid.test(String(userId))) throw new Error('请选择有效用户');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) throw new Error('安装包密码需为 12–128 位，不能包含换行');
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('有效期需为 1–365 天');
  const issuer = new X509Certificate(await readFile(process.env.CERT_ISSUER_CERT));
  if (!issuer.ca || Date.parse(issuer.validTo) <= Date.now()+days*86400000) throw new Error('签发 CA 有效期不足');
  const dir=await mkdtemp(path.join(tmpdir(),'changmen-cert-issue-')); await chmod(dir,0o700);
  try {
    const key=path.join(dir,'client.key'),csr=path.join(dir,'client.csr'),crt=path.join(dir,'client.crt'),ext=path.join(dir,'client.cnf'),p12=path.join(dir,'client.p12');
    await run(['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',key]); await chmod(key,0o600);
    await run(['req','-new','-key',key,'-subj',`/CN=cm-user-${userId}`,'-out',csr]);
    await writeFile(ext,`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nsubjectAltName=URI:urn:changmen:user:${userId}\n`,{mode:0o600});
    await run(['x509','-req','-in',csr,'-CA',process.env.CERT_ISSUER_CERT,'-CAkey',process.env.CERT_ISSUER_KEY,'-set_serial','0x'+randomBytes(20).toString('hex'),'-days',String(days),'-sha256','-extfile',ext,'-out',crt]);
    const pem=await readFile(crt,'utf8'); await verifyManagedCertificate(pem);
    await run(['pkcs12','-export','-out',p12,'-inkey',key,'-in',crt,'-certfile',process.env.CERT_ISSUER_CHAIN,'-name','changmen-'+userId,'-passout','env:CM_CERT_EXPORT_PASSWORD'], { env:{...process.env,CM_CERT_EXPORT_PASSWORD:password} });
    return { ...certificateMetadata(pem,userId,label), p12: (await readFile(p12)).toString('base64') };
  } finally { await rm(dir,{recursive:true,force:true}); }
}
