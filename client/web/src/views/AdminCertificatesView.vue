<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import { listCertificates, issueCertificate, registerCertificate, revokeCertificate, type CertificateList, type CertificateRow } from '@/api/certificates';
const data = ref<CertificateList>({ certificates: [], users: [], issuerReady: false, legacyEnabled: true });
const busy = ref(false);
const error = ref('');
const userId = ref('');
const label = ref('');
const password = ref('');
const days = ref(180);
const pem = ref('');
async function load() {
  try { data.value = await listCertificates(); error.value = ''; }
  catch (e) { error.value = e instanceof Error ? e.message : '加载失败'; }
}
async function issue() {
  if (!userId.value || password.value.length < 12) { ElMessage.error('请选择用户并设置至少 12 位安装包密码'); return; }
  busy.value = true;
  try {
    const result = await issueCertificate({ userId: userId.value, label: label.value, password: password.value, days: days.value });
    const bytes = Uint8Array.from(atob(result.p12), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/x-pkcs12' }));
    const link = document.createElement('a'); link.href = url; link.download = result.fileName; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    password.value = ''; await load(); ElMessage.success('已签发并下载，请妥善保存安装包和密码');
  }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : '签发失败'); }
  finally { busy.value = false; }
}
async function register() {
  busy.value = true;
  try { await registerCertificate({ userId: userId.value, label: label.value, pem: pem.value }); pem.value = ''; await load(); ElMessage.success('旧证书已绑定到该用户'); }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : '登记失败'); }
  finally { busy.value = false; }
}
async function revoke(row: CertificateRow) {
  try {
    await ElMessageBox.confirm(`吊销 ${row.user_name} 的证书「${row.label || row.serial}」后，该证书将不能登录或继续访问用户业务。`, '吊销证书', { type: 'warning' });
    busy.value = true; await revokeCertificate(row.fingerprint, '管理员在证书管理页面吊销'); await load(); ElMessage.success('已吊销');
  }
  catch (e) { if (e instanceof Error) ElMessage.error(e.message); }
  finally { busy.value = false; }
}
function status(row: CertificateRow) { return row.revoked_at ? '已吊销' : Number(row.expires_at) <= Date.now() ? '已过期' : '有效'; }
onMounted(load);
</script>
<template>
  <AdminLayout title="用户证书" subtitle="仅管理员可签发、绑定和吊销用户证书">
    <section class="certificate-page">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-if="!data.issuerReady" title="签发服务尚未配置，暂时不能生成新证书" type="warning" :closable="false" />
      <p v-if="data.legacyEnabled">现有未登记证书仍兼容原来的用户名绑定；已登记证书使用固定用户身份。</p>
      <div class="cert-form">
        <el-select v-model="userId" filterable placeholder="选择所属用户" style="width: 220px">
          <el-option v-for="u in data.users" :key="u.id" :label="u.user_name" :value="u.id" />
        </el-select>
        <el-input v-model="label" placeholder="设备 / 证书备注" maxlength="80" style="width: 220px" />
        <el-input-number v-model="days" :min="1" :max="365" /> <span>天</span>
        <el-input v-model="password" type="password" show-password autocomplete="new-password" placeholder="安装包密码，至少 12 位" style="width: 260px" />
        <el-button type="primary" :loading="busy" :disabled="!data.issuerReady" @click="issue">签发并下载安装包</el-button>
      </div>
      <p>安装包仅本次提供下载，丢失请补发。补发不会自动吊销旧证书，请确认用户安装成功后再吊销旧证书。</p>
      <el-collapse>
        <el-collapse-item title="登记现有证书（不需要换证或重新安装）" name="register">
          <p>选择所属用户后，粘贴公开的 .crt / PEM 内容。不要上传私钥或安装包。</p>
          <el-input v-model="pem" type="textarea" :rows="5" placeholder="-----BEGIN CERTIFICATE-----" />
          <el-button :loading="busy" :disabled="!userId || !pem" @click="register">绑定现有证书</el-button>
        </el-collapse-item>
      </el-collapse>
      <el-button :disabled="busy" @click="load">刷新列表</el-button>
      <el-table :data="data.certificates" stripe>
        <el-table-column prop="user_name" label="用户" width="120" />
        <el-table-column prop="label" label="备注" width="160" />
        <el-table-column label="状态" width="90"><template #default="{ row }">{{ status(row) }}</template></el-table-column>
        <el-table-column label="到期时间" width="190"><template #default="{ row }">{{ new Date(Number(row.expires_at)).toLocaleString() }}</template></el-table-column>
        <el-table-column prop="subject_cn" label="证书标识" min-width="200" show-overflow-tooltip />
        <el-table-column prop="fingerprint" label="指纹" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="100"><template #default="{ row }"><el-button type="danger" link :disabled="busy || !!row.revoked_at" @click="revoke(row)">吊销</el-button></template></el-table-column>
      </el-table>
    </section>
  </AdminLayout>
</template>
<style scoped>
.certificate-page { padding: 20px; overflow: auto; height: 100%; }
.cert-form { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 20px 0; }
p { margin: 14px 0; color: var(--el-text-color-secondary); }
.el-alert { margin-bottom: 14px; }
.el-collapse { margin: 20px 0; }
</style>
