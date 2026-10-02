import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { issueManagedCertificate, certificateMetadata } from '../certificates/issuer.js';
it('issues userId client certificate and encrypted PKCS12 using a disposable CA',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'changmen-cert-test-'));const saved={...process.env};
  try{
    const crt=path.join(dir,'ca.crt'),key=path.join(dir,'ca.key');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=Test CA','-days','10','-keyout',key,'-out',crt,'-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});
    Object.assign(process.env,{CERT_ISSUER_CERT:crt,CERT_ISSUER_KEY:key,CERT_ISSUER_CHAIN:crt,CERT_CA_BUNDLE:crt});
    const userId='00000000-0000-0000-0000-000000000001';
    const cert=await issueManagedCertificate({userId,password:'Test-only-password-strong',days:1,label:'test'});
    expect(cert.cn).toBe('cm-user-'+userId);expect(cert.userId).toBe(userId);expect(cert.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(cert.p12.length).toBeGreaterThan(1000);
    expect(()=>certificateMetadata(readFileSync(crt,'utf8'),userId)).toThrow(/客户端证书/);
    await expect(issueManagedCertificate({userId,password:'short',days:1})).rejects.toThrow(/密码/);
  }finally{process.env={...saved};rmSync(dir,{recursive:true,force:true});}
},30000);
