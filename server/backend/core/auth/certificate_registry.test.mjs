import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../../../db/rds/common.js',()=>({getPgPool:()=>({query:mocks.query})}));
import { authorizeClientCertificate } from '../../../db/rds/client_certificate_store.js';
import { authenticateIdentity } from './identity.js';
import { readClientCertStatus } from '../shared/client_cert_gate.js';
import { tryCertificateRoutes } from '../certificates/routes.js';
const saved={...process.env};
const fp='a'.repeat(64);
beforeEach(()=>{mocks.query.mockReset();process.env.CLIENT_CERT_REGISTRY_ENABLED='1';process.env.CLIENT_CERT_LEGACY_ENABLED='1';});
afterEach(()=>{process.env={...saved};});
describe('certificate immutable ownership and legacy compatibility',()=>{
  it('allows a registered certificate after username changes and rejects another user',async()=>{
    mocks.query.mockResolvedValue({rows:[{user_id:'user-id',expires_at:Date.now()+100000}]});
    expect(await authorizeClientCertificate({certFingerprint:fp,certCn:'old-name'},'user-id')).toBe(null);
    expect(await authorizeClientCertificate({certFingerprint:fp},'other-id')).toBe('CERT_BIND_FAILED');
  });
  it('does not let revoked or expired registrations fall back to CN',async()=>{
    for(const row of [{revoked_at:1,expires_at:Date.now()+10000},{expires_at:1}]){
      mocks.query.mockResolvedValue({rows:[{user_id:'user-id',...row}]});
      expect(await authorizeClientCertificate({certFingerprint:fp,certCn:'river'},'user-id')).toBe('CERT_BIND_FAILED');
    }
  });
  it('keeps unknown legacy leaves compatible only for the matching username',async()=>{
    mocks.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{user_name:'River'}]});
    expect(await authorizeClientCertificate({certFingerprint:fp,certCn:'RIVER'},'user-id')).toBe(null);
    process.env.CLIENT_CERT_LEGACY_ENABLED='0';mocks.query.mockResolvedValue({rows:[]});
    expect(await authorizeClientCertificate({certFingerprint:fp,certCn:'river'},'user-id')).toBe('CERT_BIND_FAILED');
  });
  it('rejects missing fingerprint and does not trust external injected headers',async()=>{
    expect(await authorizeClientCertificate({certCn:'river'},'user-id')).toBe('CERT_BIND_FAILED');
    const headers={'x-changmen-client-cert':'1','x-changmen-client-subject':'CN=river','x-changmen-client-fingerprint':fp};
    expect(readClientCertStatus({headers,socket:{remoteAddress:'8.8.8.8'}})).toEqual({hasClientCert:false,subject:''});
    expect(readClientCertStatus({headers,socket:{remoteAddress:'127.0.0.1'}}).fingerprint).toBe(fp);
  });
  it('certificate revocation also rejects otherwise valid JWT identity',async()=>{
    const result=await authenticateIdentity({token:'jwt',audit:{certFingerprint:fp}}, {
      authGetUserStatus:async()=>({userId:'u',loginEpoch:'e'}),authorizeClientCertificate:async()=> 'CERT_BIND_FAILED',
    });
    expect(result.code).toBe('CERT_BIND_FAILED');
  });
});
describe('certificate admin HTTP permission',()=>{
  it('rejects ordinary users and leaders before any certificate database operation',async()=>{
    const list=vi.fn();
    for(const role of ['user','leader']){
      const res={setHeader:vi.fn(),writeHead:vi.fn(),end:vi.fn()};
      await tryCertificateRoutes({url:'/api/admin/certificates',method:'GET'},res,{requireHttpUser:async()=>({user:{id:'u',role}}),db:{listClientCertificates:list}});
      expect(res.writeHead.mock.calls[0][0]).toBe(403);
    }
    expect(list).not.toHaveBeenCalled();
  });
});
