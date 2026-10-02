<script setup lang="ts">
import type { LeaderboardUser } from "@/api/adminLeaderboard";
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { getLeaderboardUsers, setLeaderboardExcluded } from "@/api/adminLeaderboard";
import AdminLayout from "@/components/admin/AdminLayout.vue";

const users = ref<LeaderboardUser[]>([]);
const loading = ref(false);
const error = ref("");
const search = ref("");
const saving = ref(new Set<string>());
const filteredUsers = computed(() => users.value.filter(row =>
  row.userName.toLowerCase().includes(search.value.trim().toLowerCase()),
));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    users.value = await getLeaderboardUsers();
  }
  catch (e) {
    error.value = (e as Error).message || "加载失败";
  }
  finally {
    loading.value = false;
  }
}

async function toggle(row: LeaderboardUser, value: boolean) {
  if (saving.value.has(row.userId))
    return;
  saving.value.add(row.userId);
  try {
    const updated = await setLeaderboardExcluded(row.userId, value);
    Object.assign(row, updated);
    ElMessage.success(value ? "已排除该用户" : "已恢复该用户参与排行榜");
  }
  catch (e) {
    ElMessage.error((e as Error).message || "保存失败");
  }
  finally {
    saving.value.delete(row.userId);
  }
}

onMounted(load);
</script>

<template>
  <AdminLayout title="排行榜设置" subtitle="管理员默认不参与，可关闭“排除战绩”让其参与。设置不影响个人战绩、订单和报表。">
    <template #toolbar>
      <el-button :loading="loading" :disabled="saving.size > 0" @click="load">刷新</el-button>
    </template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-card>
      <el-input v-model="search" placeholder="搜索用户名" clearable class="leaderboard-search" />
      <el-table v-loading="loading" :data="filteredUsers" row-key="userId" empty-text="暂无用户">
        <el-table-column prop="userName" label="用户" min-width="180" />
        <el-table-column label="排行榜状态" min-width="160">
          <template #default="{ row }">
            <el-tag :type="row.excluded ? 'info' : 'success'">
              {{ row.excluded ? "已排除" : "参与排行榜" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="排除战绩" width="160">
          <template #default="{ row }">
            <el-switch
              :model-value="row.excluded"
              :disabled="loading || saving.has(row.userId)"
              :loading="saving.has(row.userId)"
              @change="toggle(row, Boolean($event))"
            />
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </AdminLayout>
</template>

<style scoped>
.leaderboard-search {
  max-width: 320px;
  margin-bottom: 16px;
}
</style>
