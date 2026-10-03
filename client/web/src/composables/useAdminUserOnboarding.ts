import { reactive, ref } from 'vue';
import { createAdminUser, type AdminUserMutationResult } from '@/api/admin';
import { issueCertificate, type CertificatePackage } from '@/api/certificates';

/** [changmen 扩展] 创建后固定用户 ID；签发失败重试不再次创建账号。 */
export function useAdminUserOnboarding(onCreated: (user: AdminUserMutationResult) => void) {
  const form = reactive({ userName: '', password: '', confirm: '', issue: true, label: '', packagePassword: '', days: 180 });
  const created = ref<AdminUserMutationResult | null>(null);
  const busy = ref(false), error = ref('');
  let disposed = false;
  const packageData = ref<CertificatePackage | null>(null);
  function clearSecrets() { form.password = ''; form.confirm = ''; form.packagePassword = ''; }
  function reset() {
    clearSecrets(); created.value = null; packageData.value = null; error.value = '';
    form.userName = ''; form.issue = true; form.label = ''; form.days = 180;
  }
  function validate() {
    if (!created.value) {
      if (!form.userName.trim()) throw new Error('请输入用户名');
      if (form.password.length < 6) throw new Error('密码至少 6 位');
      if (form.password !== form.confirm) throw new Error('两次密码不一致');
    }
    if (form.issue) {
      if (form.label.length > 80) throw new Error('设备备注不能超过 80 字');
      if (form.packagePassword.length < 12 || form.packagePassword.length > 128) throw new Error('安装包密码需要 12–128 位');
      if (!Number.isInteger(form.days) || form.days < 1 || form.days > 365) throw new Error('证书有效期需要 1–365 天');
    }
  }
  async function submit(): Promise<boolean> {
    if (disposed || busy.value || packageData.value) return false;
    busy.value = true; error.value = '';
    try {
      validate();
      const attempt = { ...form };
      if (!created.value) {
        const result = await createAdminUser(attempt.userName.trim(), attempt.password);
        if (disposed) return false;
        created.value = result;
        form.password = ''; form.confirm = '';
        onCreated(created.value);
      }
      if (attempt.issue) {
        const result = await issueCertificate({ userId: created.value.id, label: attempt.label, password: attempt.packagePassword, days: attempt.days, purpose: 'ISSUE' });
        if (disposed) return false;
        packageData.value = result;
      }
      clearSecrets(); return true;
    } catch (e) {
      if (disposed) return false;
      error.value = e instanceof Error ? e.message : '操作失败'; return false;
    } finally { busy.value = false; }
  }
  function dispose() { disposed = true; reset(); }
  return { form, created, busy, error, packageData, submit, reset, clearSecrets, dispose };
}
