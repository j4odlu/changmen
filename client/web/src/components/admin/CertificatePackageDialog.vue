<script setup lang="ts">
import type { CertificatePackage } from '@/api/certificates';
defineProps<{ packageData: CertificatePackage | null }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ closed: [] }>();
function downloadPackage(value: CertificatePackage | null) {
  if (!value) return;
  const content = Uint8Array.from(atob(value.p12), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([content], { type: 'application/x-pkcs12' }));
  const link = document.createElement('a'); link.href = url; link.download = value.fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
</script>
<template>
  <el-dialog v-model="open" title="证书已签发，请下载安装包" width="600px" :close-on-click-modal="false" @closed="emit('closed')">
    <el-alert title="关闭此窗口后，安装包无法再次取回。丢失请补发新证书。" type="warning" :closable="false" />
    <p>安装包已加密，请把文件和安装包密码分别妥善交给所属用户。</p>
    <p class="mono">{{ packageData?.fingerprint }}</p>
    <slot />
    <template #footer>
      <el-button type="primary" :disabled="!packageData" @click="downloadPackage(packageData)">下载 .p12 安装包</el-button>
      <el-button @click="open = false">我已保存，关闭窗口</el-button>
    </template>
  </el-dialog>
</template>
<style scoped>
p { margin: 12px 0; color: var(--el-text-color-secondary); line-height: 1.7; }
.mono { font-family: monospace; overflow-wrap: anywhere; }
</style>
