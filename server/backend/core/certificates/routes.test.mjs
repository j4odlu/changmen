import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { tryCertificateRoutes } from './routes.js';
const fp='a'.repeat(64), other='b'.repeat(64);
async function call(path,body,store,role='admin') {
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
  Object.assign(req,{url:'/api/admin/certificates'+path,method:body===undefined?'GET':'POST',headers:{'x-changmen-client-cert':'1','x-changmen-client-subject':'CN=river','x-changmen-client-fingerprint':fp},socket:{remoteAddress:'127.0.0.1'}});
  const res={setHeader:vi.fn(),writeHead:vi.fn(),end:vi.fn()};
  await tryCertificateRoutes(req,res,{db:store,requireHttpUser:async()=>({user:{id:'admin',role}})});
  return {status:res.writeHead.mock.calls[0][0],body:JSON.parse(res.end.mock.calls[0][0])};
}
it('protects the current administrator certificate inside a bulk selection atomically',async()=>{
  const revokeClientCertificates=vi.fn();
  expect((await call('/revoke-batch',{fingerprints:[other,fp],reason:'lost'}, {revokeClientCertificates})).status).toBe(409);
  expect(revokeClientCertificates).not.toHaveBeenCalled();
});
it('validates bulk selections before any database writes',async()=>{
  const revokeClientCertificates=vi.fn();
  for(const fingerprints of [[],['invalid'],Array(51).fill(other)]) expect((await call('/revoke-batch',{fingerprints,reason:'lost'}, {revokeClientCertificates})).status).toBe(400);
  expect(revokeClientCertificates).not.toHaveBeenCalled();
});
it('denies leaders for certificate details and editing',async()=>{
  const getClientCertificateDetail=vi.fn(),updateClientCertificateLabel=vi.fn();
  expect((await call('/detail?fingerprint='+other,undefined,{getClientCertificateDetail},'leader')).status).toBe(403);
  expect((await call('/label',{fingerprint:other,label:'device'},{updateClientCertificateLabel},'user')).status).toBe(403);
  expect(getClientCertificateDetail).not.toHaveBeenCalled();expect(updateClientCertificateLabel).not.toHaveBeenCalled();
});
it('returns public details and passes the actor for label auditing',async()=>{
  const updateClientCertificateLabel=vi.fn().mockResolvedValue({updated:true});
  expect((await call('/label',{fingerprint:other,label:'device'},{updateClientCertificateLabel})).status).toBe(200);
  expect(updateClientCertificateLabel).toHaveBeenCalledWith(other,'device','admin');
  const getClientCertificateDetail=vi.fn().mockResolvedValue({certificate:{certificate_pem:'public'},audit:[]});
  expect((await call('/detail?fingerprint='+other,undefined,{getClientCertificateDetail})).body.certificate.certificate_pem).toBe('public');
});
it('rejects replacement of another user certificate before private key generation',async()=>{
  const getClientCertificate=vi.fn().mockResolvedValue({user_id:'other-user'});
  const result=await call('/issue',{userId:'u',replacesFingerprint:other,purpose:'RENEW'}, {certificateRegistryEnabled:()=>true,listClientCertificates:async()=>({users:[{id:'u'}]}),getClientCertificate});
  expect(result.status).toBe(409);
});
