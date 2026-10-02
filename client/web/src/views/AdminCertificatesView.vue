<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import { listCertificates, certificateDetail, issueCertificate, registerCertificate, updateCertificateLabel, revokeCertificates,
  type CertificateList, type CertificateRow, type CertificateDetail } from '@/api/certificates';
import { certificateState, certificateStateLabels, filterCertificates, certificateCsv } from '@/shared/certificateManagement';
const data = ref<CertificateList>({ certificates: [], users: [], issuerReady: false, legacyEnabled: false, currentFingerprint: '', authority: { ready: false, root: null, issuer: null } });
const busy = ref(false), loading = ref(false), error = ref(''), now = ref(Date.now());
const query = ref(''), filterUser = ref(''), filterState = ref(''), page = ref(1), pageSize = ref(20);
const selected = ref<CertificateRow[]>([]);
const filtered = computed(() => filterCertificates(data.value.certificates, query.value, filterUser.value, filterState.value, now.value));
const paginated = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
const counts = computed(() => ({ total: data.value.certificates.length, expiring: data.value.certificates.filter(r => certificateState(r,now.value) === 'expiring').length,
  expired: data.value.certificates.filter(r => certificateState(r,now.value) === 'expired').length, revoked: data.value.certificates.filter(r => !!r.revoked_at).length,
  uncovered: data.value.users.filter(u => !data.value.certificates.some(r => r.user_id === u.id && ['valid','expiring'].includes(certificateState(r,now.value)))).length }));
watch([query, filterUser, filterState, pageSize], () => { page.value = 1; selected.value = []; });
const formOpen = ref(false), formMode = ref<'ISSUE' | 'RENEW' | 'REISSUE' | 'REGISTER'>('ISSUE');
const userId = ref(''), label = ref(''), password = ref(''), days = ref(180), pem = ref(''), previous = ref<CertificateRow | null>(null);
const title = computed(() => ({ ISSUE: '签发新设备证书', RENEW: '续期证书', REISSUE: '补发证书', REGISTER: '登记现有证书' }[formMode.value]));
const detailOpen = ref(false), detailLoading = ref(false), detailError = ref(''), detail = ref<CertificateDetail | null>(null);
const detailRow = ref<CertificateRow | null>(null);
const packageOpen = ref(false), packageData = ref<{ fileName: string; p12: string; fingerprint: string } | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
function message(e: unknown) { return e instanceof Error ? e.message : '请求失败'; }
function date(value: unknown) { return value ? new Date(Number(value)).toLocaleString('zh-CN') : '—'; }
function download(content: BlobPart, fileName: string, type = 'application/x-pem-file') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function downloadPackage() {
  if (packageData.value) download(Uint8Array.from(atob(packageData.value.p12), c => c.charCodeAt(0)), packageData.value.fileName, 'application/x-pkcs12');
}
function clearPackage() { packageData.value = null; }
function beforeCloseForm(done: () => void) { if (!busy.value) done(); }
async function load() {
  loading.value = true;
  try { data.value = await listCertificates(); error.value = ''; now.value = Date.now(); selected.value = []; page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / pageSize.value))); }
  catch (e) { error.value = message(e); }
  finally { loading.value = false; }
}
function openForm(mode: typeof formMode.value, row?: CertificateRow) {
  formMode.value = mode; previous.value = row || null; userId.value = row?.user_id || filterUser.value; label.value = row?.label || '';
  password.value = ''; pem.value = ''; days.value = 180; formOpen.value = true;
}
async function submit() {
  if (!userId.value) { ElMessage.error('请选择所属用户'); return; }
  busy.value = true;
  try {
    if (formMode.value === 'REGISTER') {
      await registerCertificate({ userId: userId.value, label: label.value, pem: pem.value });
      ElMessage.success('现有证书已登记，无需重新安装');
    } else {
      packageData.value = await issueCertificate({ userId: userId.value, label: label.value, password: password.value, days: days.value,
        purpose: formMode.value, ...(previous.value ? { replacesFingerprint: previous.value.fingerprint } : {}) });
      packageOpen.value = true;
    }
    password.value = ''; pem.value = ''; formOpen.value = false; await load();
  } catch (e) { ElMessage.error(message(e)); }
  finally { busy.value = false; }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try { if (file.size > 64000) throw new Error('请上传小于 64 KB 的公开证书文件'); pem.value = await file.text(); if (!pem.value.includes('-----BEGIN CERTIFICATE-----') || pem.value.includes('PRIVATE KEY')) throw new Error('仅接受公开 PEM / CRT 证书，不能上传私钥或安装包'); }
  catch (e) { pem.value = ''; ElMessage.error(message(e)); }
  finally { input.value = ''; }
}
async function showDetail(row: CertificateRow) {
  detailRow.value = row; detail.value = null; detailError.value = ''; detailOpen.value = true; detailLoading.value = true;
  try { detail.value = await certificateDetail(row.fingerprint); }
  catch (e) { detailError.value = message(e); }
  finally { detailLoading.value = false; }
}
async function editLabel(row: CertificateRow) {
  try {
    const result = await ElMessageBox.prompt('填写设备名称或备注（最多 80 字）', '编辑设备备注', { inputValue: row.label, inputValidator: value => value.length <= 80 || '备注不能超过 80 字' });
    busy.value = true; await updateCertificateLabel(row.fingerprint, result.value); await load(); ElMessage.success('备注已更新');
  } catch (e) { if (e instanceof Error) ElMessage.error(message(e)); }
  finally { busy.value = false; }
}
function selectable(row: CertificateRow) { return !row.revoked_at && row.fingerprint !== data.value.currentFingerprint; }
async function revoke(rows: CertificateRow[]) {
  if (!rows.length) return;
  try {
    const result = await ElMessageBox.prompt(`将吊销 ${rows.length} 张证书，其登录和用户业务会话将失效。此操作无法恢复，请填写原因。`, '确认吊销', {
      type: 'warning', inputPlaceholder: '例如：设备丢失、人员离职、已完成换证', inputValidator: value => !!value?.trim() && value.trim().length <= 200 || '请填写 1–200 字原因', confirmButtonText: '确认吊销',
    });
    busy.value = true; const response = await revokeCertificates(rows.map(r => r.fingerprint), result.value.trim()); await load(); ElMessage.success(`已吊销 ${response.revoked} 张证书`);
    if (detailRow.value && rows.some(r => r.fingerprint === detailRow.value?.fingerprint)) detailOpen.value = false;
  } catch (e) { if (e instanceof Error) ElMessage.error(message(e)); }
  finally { busy.value = false; }
}
function auditLabel(operation: string) { return ({ ISSUE: '签发', REGISTER: '登记', MIGRATE: '迁移登记', RENEW: '续期', REISSUE: '补发', LABEL: '修改备注', REVOKE: '吊销' } as Record<string,string>)[operation] || operation; }
function auditDescription(details: Record<string, unknown>) { return details.reason ? String(details.reason) : details.after !== undefined ? `备注：${details.before || '空'} → ${details.after || '空'}` : details.replacesFingerprint ? `替换原证书 ${details.replacesFingerprint}` : details.label ? `备注：${details.label}` : ''; }
onMounted(() => { void load(); timer = setInterval(() => { now.value = Date.now(); }, 60000); });
onUnmounted(() => { clearInterval(timer); clearPackage(); });
</script>
<template>
  <AdminLayout title="用户证书" subtitle="管理用户与设备证书的签发、续期、安装和吊销">
    <section class="certificate-page" v-loading="loading">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-if="!data.issuerReady && !loading" title="签发服务不可用，请检查 CA 有效期和签发配置；现有证书管理仍可使用" type="warning" :closable="false" />
      <div class="summary">
        <div><strong>{{ counts.total }}</strong><span>证书总数</span></div>
        <div><strong>{{ counts.expiring }}</strong><span>30 天内到期</span></div>
        <div><strong>{{ counts.expired }}</strong><span>已过期</span></div>
        <div><strong>{{ counts.revoked }}</strong><span>已吊销</span></div>
        <div><strong>{{ counts.uncovered }}</strong><span>没有有效证书的用户</span></div>
      </div>
      <div class="toolbar">
        <el-input v-model="query" clearable placeholder="搜索用户、设备备注、序列号或指纹" style="width: 300px" />
        <el-select v-model="filterUser" clearable filterable placeholder="全部用户" style="width: 180px"><el-option v-for="u in data.users" :key="u.id" :label="u.user_name" :value="u.id" /></el-select>
        <el-select v-model="filterState" clearable placeholder="全部状态" style="width: 160px"><el-option v-for="(name, key) in certificateStateLabels" :key="key" :label="name" :value="key" /></el-select>
        <el-button :disabled="busy" @click="load">刷新</el-button>
        <el-button :disabled="!filtered.length" @click="download(certificateCsv(filtered, now), 'changmen-certificates.csv', 'text/csv;charset=utf-8')">导出当前清单</el-button>
      </div>
      <div class="toolbar">
        <el-button type="primary" :disabled="busy || !data.issuerReady" @click="openForm('ISSUE')">签发新设备证书</el-button>
        <el-button :disabled="busy" @click="openForm('REGISTER')">登记现有证书</el-button>
        <el-button type="danger" :disabled="busy || !selected.length || selected.length > 50" @click="revoke(selected)">批量吊销（{{ selected.length }}）</el-button>
        <span class="muted">当前管理证书受保护；每台设备建议独立签发。</span>
      </div>
      <el-table :data="paginated" row-key="fingerprint" stripe @selection-change="selected = $event">
        <el-table-column type="selection" :selectable="selectable" width="44" />
        <el-table-column prop="user_name" label="所属用户" width="110" />
        <el-table-column prop="label" label="设备 / 备注" min-width="170"><template #default="{ row }">{{ row.label || '未命名' }} <el-tag v-if="row.fingerprint === data.currentFingerprint" size="small">当前证书</el-tag></template></el-table-column>
        <el-table-column label="状态" width="140"><template #default="{ row }"><el-tag :type="row.revoked_at || certificateState(row, now) === 'expired' ? 'danger' : certificateState(row, now) === 'expiring' ? 'warning' : 'success'">{{ certificateStateLabels[certificateState(row, now)] }}</el-tag></template></el-table-column>
        <el-table-column label="到期时间" width="175"><template #default="{ row }">{{ date(row.expires_at) }}</template></el-table-column>
        <el-table-column label="浏览器会话" width="105"><template #default="{ row }">{{ row.active_sessions || 0 }}</template></el-table-column>
        <el-table-column prop="fingerprint" label="证书指纹" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="280" fixed="right"><template #default="{ row }">
          <el-button link type="primary" @click="showDetail(row)">详情</el-button>
          <el-button link :disabled="busy" @click="editLabel(row)">备注</el-button>
          <el-button link :disabled="busy || !data.issuerReady || !!row.revoked_at" @click="openForm('RENEW', row)">续期</el-button>
          <el-button link :disabled="busy || !data.issuerReady" @click="openForm('REISSUE', row)">补发</el-button>
          <el-button link type="danger" :disabled="busy || !selectable(row)" @click="revoke([row])">吊销</el-button>
        </template></el-table-column>
      </el-table>
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50]" :total="filtered.length" layout="total, sizes, prev, pager, next" class="pagination" />
      <el-collapse class="trust-panel">
        <el-collapse-item title="CA 状态、证书下载与安装说明" name="authority">
          <p>新旧证书均绑定固定用户身份。吊销只影响对应证书；已吊销记录和审计保留，不可恢复或改绑其他用户。</p>
          <p v-if="data.authority.issuer">签发 CA 到期：{{ date(data.authority.issuer.expiresAt) }}</p>
          <p v-if="data.authority.root">根 CA 到期：{{ date(data.authority.root.expiresAt) }}</p>
          <el-button :disabled="!data.authority.root" @click="data.authority.root && download(data.authority.root.pem, 'changmen-ca.crt')">下载根 CA 公共证书</el-button>
          <el-button :disabled="!data.authority.issuer" @click="data.authority.issuer && download(data.authority.issuer.pem, 'changmen-issuing-ca.crt')">下载签发 CA 公共证书</el-button>
          <p>安装包为加密 .p12 文件。按系统证书导入向导输入安装包密码，浏览器提示时选择对应证书，再重新登录确认。不要上传或分享私钥。</p>
          <p>已下载的历史安装包不在服务器保存。安装包丢失或需要更换密码，请补发新证书；公开 .crt 文件不能代替安装包。</p>
        </el-collapse-item>
      </el-collapse>
    </section>
    <el-dialog v-model="formOpen" :title="title" width="620px" :close-on-click-modal="false" :before-close="beforeCloseForm" @closed="password = ''; pem = ''">
      <el-alert v-if="previous" title="会生成新证书并保留原证书。请先确认用户安装成功，再单独吊销原证书。" type="info" :closable="false" />
      <el-form label-width="105px" class="cert-form" @submit.prevent="submit">
        <el-form-item label="所属用户"><el-select v-model="userId" filterable :disabled="!!previous || busy"><el-option v-for="u in data.users" :key="u.id" :label="u.user_name" :value="u.id" /></el-select></el-form-item>
        <el-form-item label="设备备注"><el-input v-model="label" maxlength="80" show-word-limit :disabled="busy" placeholder="例如：办公室电脑 / 笔记本" /></el-form-item>
        <template v-if="formMode !== 'REGISTER'">
          <el-form-item label="有效期"><el-input-number v-model="days" :min="1" :max="365" :disabled="busy" /> <span>天，自本次签发日起计算</span></el-form-item>
          <el-form-item label="安装包密码"><el-input v-model="password" type="password" show-password autocomplete="new-password" maxlength="128" :disabled="busy" placeholder="12–128 位，用于证书导入" /></el-form-item>
        </template>
        <template v-else><el-form-item label="公开证书"><div><input type="file" accept=".crt,.pem" :disabled="busy" @change="importFile" /><el-input v-model="pem" type="textarea" :rows="7" :disabled="busy" placeholder="粘贴 PEM 内容，或导入公开证书文件" /></div></el-form-item><p>登记不会重新签发，不需要换证。请核对所属用户，登记后的归属不能更改。</p></template>
      </el-form>
      <template #footer><el-button :disabled="busy" @click="formOpen = false">取消</el-button><el-button type="primary" :loading="busy" :disabled="!userId || (formMode === 'REGISTER' ? !pem : password.length < 12)" @click="submit">{{ formMode === 'REGISTER' ? '确认登记' : '签发安装包' }}</el-button></template>
    </el-dialog>
    <el-dialog v-model="packageOpen" title="证书已签发，请下载安装包" width="600px" :close-on-click-modal="false" @closed="clearPackage">
      <el-alert title="关闭此窗口后，安装包无法再次取回。丢失请补发新证书。" type="warning" :closable="false" />
      <p>安装包已加密，请把文件和安装包密码分别妥善交给所属用户。</p>
      <p class="mono">{{ packageData?.fingerprint }}</p>
      <p v-if="previous">原证书仍有效（若原先已过期或吊销则维持原状态）。用户安装并登录确认后，可在列表中吊销原证书。</p>
      <template #footer><el-button type="primary" @click="downloadPackage">下载 .p12 安装包</el-button><el-button @click="packageOpen = false">我已保存，关闭窗口</el-button></template>
    </el-dialog>
    <el-drawer v-model="detailOpen" title="证书详情与审计" size="650px">
      <div v-loading="detailLoading"><el-alert v-if="detailError" :title="detailError" type="error" :closable="false" />
        <template v-if="detail && detailRow">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="所属用户">{{ detailRow.user_name }}</el-descriptions-item>
            <el-descriptions-item label="不可变用户 ID"><span class="mono">{{ detail.certificate.user_id }}</span></el-descriptions-item>
            <el-descriptions-item label="设备备注">{{ detail.certificate.label || '未命名' }}</el-descriptions-item>
            <el-descriptions-item label="状态">{{ certificateStateLabels[certificateState(detail.certificate, now)] }}</el-descriptions-item>
            <el-descriptions-item label="证书标识">{{ detail.certificate.subject_cn }}</el-descriptions-item>
            <el-descriptions-item label="序列号">{{ detail.certificate.serial }}</el-descriptions-item>
            <el-descriptions-item label="SHA-256 指纹"><span class="mono">{{ detail.certificate.fingerprint }}</span></el-descriptions-item>
            <el-descriptions-item label="生效 / 到期">{{ date(detail.certificate.not_before) }} / {{ date(detail.certificate.expires_at) }}</el-descriptions-item>
            <el-descriptions-item label="登记时间">{{ date(detail.certificate.created_at) }}</el-descriptions-item>
            <el-descriptions-item label="最近浏览器活动">{{ date(detailRow.last_browser_activity) }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.certificate.replaces_fingerprint" label="原证书指纹"><span class="mono">{{ detail.certificate.replaces_fingerprint }}</span></el-descriptions-item>
            <el-descriptions-item v-if="detail.certificate.revoked_at" label="吊销时间 / 原因">{{ date(detail.certificate.revoked_at) }} / {{ detail.certificate.revoke_reason }}</el-descriptions-item>
          </el-descriptions>
          <el-button class="detail-download" @click="download(detail.certificate.certificate_pem, `changmen-${detail.certificate.serial}.crt`)">下载公开证书 .crt</el-button>
          <h3>最近 100 条操作记录</h3>
          <el-timeline><el-timeline-item v-for="a in detail.audit" :key="a.id" :timestamp="date(a.created_at)"><strong>{{ auditLabel(a.operation) }}</strong> · {{ a.actor_name || '系统' }}<p>{{ auditDescription(a.details) }}</p></el-timeline-item></el-timeline>
          <el-empty v-if="!detail.audit.length" description="没有操作记录" />
        </template>
      </div>
    </el-drawer>
  </AdminLayout>
</template>
<style scoped>
.certificate-page { padding: 20px; overflow: auto; height: 100%; }
.summary { display: grid; grid-template-columns: repeat(5,minmax(120px,1fr)); gap: 12px; margin-bottom: 20px; }
.summary > div { display: flex; flex-direction: column; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 8px; }
.summary strong { font-size: 26px; }.summary span, .muted { color: var(--el-text-color-secondary); font-size: 13px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
.pagination { margin: 18px 0; }.trust-panel { margin-top: 24px; }.cert-form { margin-top: 18px; }
p { margin: 12px 0; color: var(--el-text-color-secondary); line-height: 1.7; }.mono { font-family: monospace; overflow-wrap: anywhere; }
.detail-download { margin: 18px 0; }.el-alert { margin-bottom: 14px; }
@media (max-width: 900px) { .summary { grid-template-columns: repeat(2,minmax(120px,1fr)); } }
</style>
