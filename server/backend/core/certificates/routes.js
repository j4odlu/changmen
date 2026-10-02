import * as db from '@changmen/db';
import { requireHttpUser } from '../auth/http_identity.js';
import { isAdminUser } from '../auth/admin_auth.js';
import { readClientCertStatus } from '../shared/client_cert_gate.js';
import { readJsonBody, jsonResponse } from '../http/body.js';
import { issuerReady, certificateMetadata, verifyManagedCertificate, issueManagedCertificate } from './issuer.js';
const issuing = new Set();

export async function tryCertificateRoutes(req,res,dependencies={}) {
  const route=String(req.url || '').split('?')[0];
  if (!route.startsWith('/api/admin/certificates')) return false;
  res.setHeader('Cache-Control','no-store');
  const send=(status,body)=>{jsonResponse(res,status,body);return true;};
  const auth=await (dependencies.requireHttpUser || requireHttpUser)(req,{alwaysCsrf:req.method!=='GET'});
  if(auth.error) return send(auth.error.status,auth.error.body);
  if(!isAdminUser(auth.user)) return send(403,{code:'FORBIDDEN',error:'仅管理员可管理用户证书'});
  const store=dependencies.db || db;
  try {
    if(route==='/api/admin/certificates' && req.method==='GET') return send(200,{...await store.listClientCertificates(),issuerReady:issuerReady() && store.certificateRegistryEnabled(),legacyEnabled:process.env.CLIENT_CERT_LEGACY_ENABLED==='1'});
    if(req.method!=='POST') return send(405,{error:'METHOD_NOT_ALLOWED'});
    const body=await readJsonBody(req);
    if(route==='/api/admin/certificates/register') {
      const data=certificateMetadata(body.pem,body.userId,body.label);
      await verifyManagedCertificate(data.pem);
      return send(200,await store.registerClientCertificate(data,auth.user.id));
    }
    if(route==='/api/admin/certificates/issue') {
      if(!store.certificateRegistryEnabled()) return send(503,{error:'证书登记校验尚未启用，暂时不能签发'});
      if(issuing.has(auth.user.id) || issuing.size >= 2) return send(429,{error:'正在签发，请稍后重试'});
      // Verify the destination user before generating any private key.
      const {users}=await store.listClientCertificates();
      if(!users.some(u=>u.id===body.userId)) return send(400,{error:'用户不存在'});
      issuing.add(auth.user.id);
      try {
        const issued=await issueManagedCertificate(body);
        await store.registerClientCertificate(issued,auth.user.id,'ISSUE');
        return send(200,{fingerprint:issued.fingerprint,p12:issued.p12,fileName:`changmen-${body.userId}-${issued.serial}.p12`});
      } finally { issuing.delete(auth.user.id); }
    }
    if(route==='/api/admin/certificates/revoke') {
      if(body.fingerprint===readClientCertStatus(req).fingerprint) return send(409,{error:'不能吊销当前管理会话正在使用的证书，请用其他管理员证书操作'});
      return send(200,await store.revokeClientCertificate(String(body.fingerprint),auth.user.id,String(body.reason || '管理员吊销').slice(0,200)));
    }
    return send(404,{error:'NOT_FOUND'});
  } catch(e) {
    // Do not expose openssl commands, passwords or private-key locations.
    return send(e.status || 400,{error:e.message?.startsWith('Command failed') ? '签发失败，请检查签发服务配置' : e.message});
  }
}
