import * as db from '@changmen/db';
import { requireHttpUser } from '../auth/http_identity.js';
import { isAdminUser } from '../auth/admin_auth.js';
import { readClientCertStatus } from '../shared/client_cert_gate.js';
import { readJsonBody, jsonResponse } from '../http/body.js';
import { certificateAuthorityStatus, certificateMetadata, verifyManagedCertificate, issueManagedCertificate } from './issuer.js';
const issuing = new Set();
const validFingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function tryCertificateRoutes(req,res,dependencies={}) {
  const url=new URL(req.url || '/', 'http://localhost');
  const route=url.pathname;
  if (route!=='/api/admin/certificates' && !route.startsWith('/api/admin/certificates/')) return false;
  res.setHeader('Cache-Control','no-store');
  const send=(status,body)=>{jsonResponse(res,status,body);return true;};
  const auth=await (dependencies.requireHttpUser || requireHttpUser)(req,{alwaysCsrf:req.method!=='GET'});
  if(auth.error) return send(auth.error.status,auth.error.body);
  if(!isAdminUser(auth.user)) return send(403,{code:'FORBIDDEN',error:'仅管理员可管理用户证书'});
  const store=dependencies.db || db;
  try {
    if(req.method==='GET') {
      if(route==='/api/admin/certificates') {
        const authority=await certificateAuthorityStatus();
        return send(200,{...await store.listClientCertificates(),issuerReady:authority.ready && store.certificateRegistryEnabled(),
          authority,currentFingerprint:readClientCertStatus(req).fingerprint || '',legacyEnabled:process.env.CLIENT_CERT_LEGACY_ENABLED==='1'});
      }
      if(route==='/api/admin/certificates/detail') {
        const fingerprint=url.searchParams.get('fingerprint');
        if(!validFingerprint(fingerprint)) return send(400,{error:'证书指纹无效'});
        return send(200,await store.getClientCertificateDetail(fingerprint));
      }
      return send(404,{error:'NOT_FOUND'});
    }
    if(req.method!=='POST') return send(405,{error:'METHOD_NOT_ALLOWED'});
    const body=await readJsonBody(req);
    if(!body || typeof body!=='object' || Array.isArray(body)) return send(400,{error:'请求内容无效'});
    if(route==='/api/admin/certificates/register') {
      const data=certificateMetadata(body.pem,body.userId,body.label);
      await verifyManagedCertificate(data.pem);
      return send(200,await store.registerClientCertificate(data,auth.user.id));
    }
    if(route==='/api/admin/certificates/issue') {
      if(!store.certificateRegistryEnabled()) return send(503,{error:'证书登记校验尚未启用，暂时不能签发'});
      if(issuing.has(auth.user.id) || issuing.size >= 2) return send(429,{error:'正在签发，请稍后重试'});
      const {users}=await store.listClientCertificates();
      if(!users.some(u=>u.id===body.userId)) return send(400,{error:'用户不存在'});
      if(body.replacesFingerprint) {
        if(!validFingerprint(body.replacesFingerprint)) return send(400,{error:'原证书指纹无效'});
        const previous=await store.getClientCertificate(body.replacesFingerprint);
        if(!previous || previous.user_id!==body.userId) return send(409,{error:'续期或补发不能改变原证书所属用户'});
      }
      if(body.purpose && !['ISSUE','RENEW','REISSUE'].includes(body.purpose)) return send(400,{error:'签发用途无效'});
      if(['RENEW','REISSUE'].includes(body.purpose) && !body.replacesFingerprint) return send(400,{error:'请选择待续期或补发的原证书'});
      issuing.add(auth.user.id);
      try {
        const issued=await issueManagedCertificate(body);
        await store.registerClientCertificate({...issued,replacesFingerprint:body.replacesFingerprint},auth.user.id,body.purpose || 'ISSUE');
        return send(200,{fingerprint:issued.fingerprint,p12:issued.p12,fileName:`changmen-${body.userId}-${issued.serial}.p12`});
      } finally { issuing.delete(auth.user.id); }
    }
    if(route==='/api/admin/certificates/label') {
      if(!validFingerprint(body.fingerprint)) return send(400,{error:'证书指纹无效'});
      return send(200,await store.updateClientCertificateLabel(body.fingerprint,body.label,auth.user.id));
    }
    if(route==='/api/admin/certificates/revoke' || route==='/api/admin/certificates/revoke-batch') {
      const selected=route.endsWith('revoke-batch')?body.fingerprints:[body.fingerprint];
      if(!Array.isArray(selected) || !selected.length || selected.length>50 || selected.some(f=>!validFingerprint(f))) return send(400,{error:'请选择 1–50 张有效证书'});
      if(selected.includes(readClientCertStatus(req).fingerprint)) return send(409,{error:'不能吊销当前管理会话正在使用的证书，请用其他管理员证书操作'});
      return send(200,await store.revokeClientCertificates(selected,auth.user.id,body.reason));
    }
    return send(404,{error:'NOT_FOUND'});
  } catch(e) {
    return send(e.status || 400,{error:e.message?.startsWith('Command failed') ? '签发失败，请检查签发服务配置' : e.message});
  }
}
