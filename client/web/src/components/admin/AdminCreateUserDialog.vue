<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { AdminUserMutationResult } from '@/api/admin';
import CertificatePackageDialog from './CertificatePackageDialog.vue';
import { useAdminUserOnboarding } from '@/composables/useAdminUserOnboarding';
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [user: AdminUserMutationResult] }>();
const { form, created, busy, error, packageData, submit, reset, dispose } = useAdminUserOnboarding(user => emit('created', user));
const packageOpen = ref(false);
function canLeave() { return !busy.value && !packageData.value; }
function beforeClose(done: () => void) {
  if (canLeave()) done();
  else ElMessage.warning('请等待操作完成，并保存安装包后关闭下载窗口');
}
async function submitForm() {
  if (!await submit()) return;
  if (packageData.value) packageOpen.value = true;
  else { ElMessage.success('用户已创建；请在用户管理中配置有效证书后再登录'); open.value = false; }
}
function finishPackage() {
  packageData.value = null;
  ElMessage.success('用户及证书已创建，请安装证书后登录验证'); open.value = false;
}
onBeforeRouteLeave(() => {
  if (canLeave()) return true;
  ElMessage.warning('请等待操作完成，并保存安装包后关闭下载窗口'); return false;
});
onUnmounted(dispose);
</script>
<template>
  <el-dialog v-model="open" :title="created ? '用户已创建 · 完成证书签发' : '新建用户'" class="admin-dialog" width="560px" destroy-on-close :close-on-click-modal="false" :before-close="beforeClose" @closed="reset">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="created" :title="`账号 ${created.userName} 已创建，重试仅签发证书，不会重复创建用户。`" type="info" :closable="false" />
    <el-form label-width="110px" :disabled="busy || !!packageData" @submit.prevent="submitForm">
      <el-form-item label="用户名" required><el-input v-model="form.userName" autocomplete="off" :disabled="!!created" /></el-form-item>
      <template v-if="!created">
        <el-form-item label="密码" required><el-input v-model="form.password" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-form-item label="确认密码" required><el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" /></el-form-item>
      </template>
      <el-form-item label="设备证书"><el-checkbox v-model="form.issue" :disabled="!!created">创建后签发证书</el-checkbox></el-form-item>
      <template v-if="form.issue">
        <el-form-item label="设备备注"><el-input v-model="form.label" maxlength="80" placeholder="例如：办公室电脑" /></el-form-item>
        <el-form-item label="有效期"><el-input-number v-model="form.days" :min="1" :max="365" /> 天</el-form-item>
        <el-form-item label="安装包密码" required><el-input v-model="form.packagePassword" type="password" show-password autocomplete="new-password" maxlength="128" placeholder="12–128 位，用于证书导入" /></el-form-item>
        <el-alert title="用户创建成功后签发证书。签发失败会保留账号，可直接重试。安装包密码用于证书导入，与登录密码分别保管。" type="info" :closable="false" />
      </template>
      <el-alert v-else title="新用户尚无有效证书，暂不能登录。稍后可从用户管理签发或登记已有证书。" type="warning" :closable="false" />
    </el-form>
    <template #footer>
      <el-button :disabled="!canLeave()" @click="open = false">{{ created ? '稍后处理证书' : '取消' }}</el-button>
      <el-button type="primary" :loading="busy" :disabled="!!packageData" @click="submitForm">{{ created ? '重试签发证书' : form.issue ? '创建用户并签发证书' : '仅创建用户' }}</el-button>
    </template>
  </el-dialog>
  <CertificatePackageDialog v-model="packageOpen" :package-data="packageData" @closed="finishPackage" />
</template>
