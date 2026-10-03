<script setup lang="ts">
import AdminLayout from '@/components/admin/AdminLayout.vue';
import CertificateManagerPanel from '@/components/admin/CertificateManagerPanel.vue';
</script>
<template>
  <AdminLayout title="证书总览" subtitle="跨用户证书巡检、批量操作与 CA 管理；单个用户的证书请从用户管理进入">
    <CertificateManagerPanel />
  </AdminLayout>
</template>
