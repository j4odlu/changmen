<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, watch } from "vue";
import {
  POD_BET_SETTINGS_UPDATED,
  POD_FOLLOW_STAKE_PRESETS,
  readPodBetSettings,
  writePodBetSettings,
  type PodBetSettings,
} from "@/runtime/podBetSettings";
import { listObSportFollowAccounts } from "@/runtime/obSportBetAccount";
import { listPmFollowAccounts } from "@/runtime/podPmFollowPlace";
import { useAccountStore } from "@/stores/accountStore";
import PodFollowAccountPicker from "@/components/football/PodFollowAccountPicker.vue";
import PodYaboSettings from "@/components/football/PodYaboSettings.vue";

const form = reactive<PodBetSettings>(readPodBetSettings());
const accounts = useAccountStore();
const followAccounts = computed(() => listObSportFollowAccounts(accounts.accounts));
const rayFollowAccounts = computed(() => accounts.accounts.filter(a => a.provider === "RAY"));
const pmFollowAccounts = computed(() => listPmFollowAccounts(accounts.accounts));

/** write / apply 期间挡掉回声，避免深监听空转或互相覆盖 */
let ready = false;
let gate = false;

function snapshot(): PodBetSettings {
  const followVenues: PodBetSettings["followVenues"] = [];
  if (form.followAccountIds.length)
    followVenues.push("OB");
  if (form.pmFollowAccountIds.length)
    followVenues.push("Polymarket");
  if (form.rayFollowAccountIds.length)
    followVenues.push("RAY");
  return {
    ...form,
    rayFollowAccountIds: form.rayFollowAccountIds.slice(),
    followAccountIds: form.followAccountIds.slice(),
    pmFollowAccountIds: form.pmFollowAccountIds.slice(),
    followVenues,
    followAccountId: form.followAccountIds[0] || 0,
  };
}

function persist() {
  if (!ready || gate)
    return;
  gate = true;
  try {
    writePodBetSettings(snapshot());
  }
  finally {
    gate = false;
  }
}

function applyExternal() {
  if (gate)
    return;
  gate = true;
  try {
    const next = readPodBetSettings();
    form.enabled = next.enabled;
    form.prematchOnly = next.prematchOnly;
    form.footballOnly = next.footballOnly;
    form.includeHt = next.includeHt;
    form.moneyline = next.moneyline;
    form.totals = next.totals;
    form.spreads = next.spreads;
    form.minDropPct = next.minDropPct;
    form.minObEdgePct = next.minObEdgePct;
    form.spreadObEdgePct = next.spreadObEdgePct;
    form.maxObEdgePct = next.maxObEdgePct;
    form.lineMatch = next.lineMatch;
    form.stakeRandomStep = next.stakeRandomStep;
    form.stakeRandomLevels = next.stakeRandomLevels;
    form.minOdds = next.minOdds;
    form.maxOdds = next.maxOdds;
    form.maxAgeSec = next.maxAgeSec;
    form.stake = next.stake;
    form.obStake = next.obStake;
    form.pmStake = next.pmStake;
    form.rayStake = next.rayStake;
    form.rayDailyOrderLimit = next.rayDailyOrderLimit;
    if (form.rayFollowAccountIds.join(",") !== next.rayFollowAccountIds.join(","))
      form.rayFollowAccountIds = next.rayFollowAccountIds.slice();
    form.autoPlace = next.autoPlace;
    form.obAccountRotation = next.obAccountRotation;
    form.maxDailyLoss = next.maxDailyLoss;
    form.obDailyOrderLimit = next.obDailyOrderLimit;
    form.pmDailyOrderLimit = next.pmDailyOrderLimit;
    form.followAccountId = next.followAccountId;
    const cur = form.followAccountIds;
    const ids = next.followAccountIds;
    if (cur.length !== ids.length || cur.some((id, i) => id !== ids[i]))
      form.followAccountIds = ids.slice();
    const curPm = form.pmFollowAccountIds;
    const pmIds = next.pmFollowAccountIds;
    if (curPm.length !== pmIds.length || curPm.some((id, i) => id !== pmIds[i]))
      form.pmFollowAccountIds = pmIds.slice();
  }
  finally {
    gate = false;
  }
}

watch(form, persist, { deep: true });

onMounted(() => {
  applyExternal();
  ready = true;
  window.addEventListener(POD_BET_SETTINGS_UPDATED, applyExternal);
});

onUnmounted(() => {
  window.removeEventListener(POD_BET_SETTINGS_UPDATED, applyExternal);
  // destroy-on-close：关窗前强制落盘（含未 blur 的数字）
  gate = false;
  ready = true;
  try {
    writePodBetSettings(snapshot());
  }
  catch { /* ignore */ }
});
</script>

<template>
  <div class="pod-bet-settings">
    <el-form label-position="left" label-width="132px" class="pod-bet-settings__form" size="small">
      <section class="pod-bet-settings__section is-top">
        <div class="pod-bet-settings__section-head">
          <h3>运行</h3>
          <p>改完即时写入本机；自动只打已确认的场。</p>
        </div>
        <div class="pod-bet-settings__grid is-two">
          <el-form-item label="启用筛选">
            <el-switch v-model="form.enabled" inline-prompt active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item label="自动下注">
            <el-switch v-model="form.autoPlace" :disabled="!form.enabled" inline-prompt active-text="开" inactive-text="关" />
          </el-form-item>
        </div>
      </section>

      <section class="pod-bet-settings__section">
        <div class="pod-bet-settings__section-head">
          <h3>账号</h3>
          <p>OB 可选择全部账号执行，或每笔轮换一个账号；PM、RAY 每个账号各下一注。</p>
        </div>
        <div class="pod-bet-settings__venue-grid">
          <div class="pod-bet-settings__venue">
            <div class="pod-bet-settings__venue-head">
              <span>OB</span>
              <small>选择账号后启用 OB</small>
            </div>
            <PodFollowAccountPicker
              v-model="form.followAccountIds"
              :accounts="followAccounts"
              variant="settings"
              :rotation="form.obAccountRotation"
            />
            <div class="pod-bet-settings__rotation">
              <div>
                <strong>轮换模式</strong>
                <small>每笔只用一个账号，按上方账号顺序切换</small>
              </div>
              <el-switch
                v-model="form.obAccountRotation"
                :disabled="form.followAccountIds.length < 2"
                inline-prompt
                active-text="开"
                inactive-text="关"
              />
            </div>
          </div>
          <div class="pod-bet-settings__venue">
            <div class="pod-bet-settings__venue-head"><span>RAY</span><small>每个已选账号各下一注</small></div>
            <PodFollowAccountPicker v-model="form.rayFollowAccountIds" :accounts="rayFollowAccounts" variant="settings" venue="RAY" />
          </div>
          <div class="pod-bet-settings__venue">
            <div class="pod-bet-settings__venue-head">
              <span>PM</span>
              <small>必须显式选择账号</small>
            </div>
            <PodFollowAccountPicker
              v-model="form.pmFollowAccountIds"
              :accounts="pmFollowAccounts"
              variant="settings"
              venue="Polymarket"
            />
          </div>
        </div>
      </section>

      <section class="pod-bet-settings__section">
        <div class="pod-bet-settings__section-head">
          <h3>金额与风控</h3>
          <p>OB/PM/RAY 是执行场馆；所有金额统一填人民币，PM 下单前自动换算成 USDC。</p>
        </div>
        <div class="pod-bet-settings__grid">
          <el-form-item label="OB金额">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.obStake"
                :min="0"
                :max="1000000"
                :step="10"
                :precision="0"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">元</span>
              <button
                v-for="n in POD_FOLLOW_STAKE_PRESETS"
                :key="`ob-${n}`"
                type="button"
                class="pod-bet-settings__chip"
                :class="{ 'is-on': form.obStake === n }"
                @click="form.obStake = n"
              >
                {{ n }}
              </button>
            </div>
          </el-form-item>
          <el-form-item label="RAY金额">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.rayStake"
                :min="0"
                :max="1000000"
                :step="10"
                :precision="0"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">元</span>
              <button
                v-for="n in POD_FOLLOW_STAKE_PRESETS"
                :key="`ray-${n}`"
                type="button"
                class="pod-bet-settings__chip"
                :class="{ 'is-on': form.rayStake === n }"
                @click="form.rayStake = n"
              >
                {{ n }}
              </button>
            </div>
          </el-form-item>
          <el-form-item label="PM金额">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.pmStake"
                :min="0"
                :max="1000000"
                :step="10"
                :precision="0"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">元</span>
              <span class="pod-bet-settings__note">下单前自动换算</span>
              <button
                v-for="n in POD_FOLLOW_STAKE_PRESETS"
                :key="`pm-${n}`"
                type="button"
                class="pod-bet-settings__chip"
                :class="{ 'is-on': form.pmStake === n }"
                @click="form.pmStake = n"
              >
                {{ n }}
              </button>
            </div>
          </el-form-item>
          <el-form-item label="当日亏损帽">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.maxDailyLoss"
                :min="0"
                :max="1000000"
                :step="50"
                :precision="0"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">元</span>
              <span class="pod-bet-settings__note">0 = 不限；只挡自动</span>
            </div>
          </el-form-item>
          <el-form-item label="OB每日单数">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.obDailyOrderLimit"
                :min="0"
                :max="10000"
                :step="1"
                :precision="0"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">单</span>
              <span class="pod-bet-settings__note">0 = 不限</span>
            </div>
          </el-form-item>
          <el-form-item label="RAY每日单数">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.rayDailyOrderLimit"
                :min="0"
                :max="10000"
                :step="1"
                :precision="0"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">单</span>
              <span class="pod-bet-settings__note">0 = 不限</span>
            </div>
          </el-form-item>
          <el-form-item label="PM每日单数">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.pmDailyOrderLimit"
                :min="0"
                :max="10000"
                :step="1"
                :precision="0"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">单</span>
              <span class="pod-bet-settings__note">0 = 不限</span>
            </div>
          </el-form-item>
        </div>
      </section>

      <section class="pod-bet-settings__section">
        <div class="pod-bet-settings__section-head">
          <h3>筛选范围</h3>
          <p>只影响进入 POD 跟单浮窗的机会。</p>
        </div>
        <div class="pod-bet-settings__grid is-two">
          <el-form-item label="只跟早盘">
            <el-switch v-model="form.prematchOnly" :disabled="!form.enabled" inline-prompt active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item label="只要足球">
            <el-switch v-model="form.footballOnly" :disabled="!form.enabled" inline-prompt active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item label="含半场">
            <el-switch v-model="form.includeHt" :disabled="!form.enabled" inline-prompt active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item label="玩法">
            <el-checkbox v-model="form.moneyline" :disabled="!form.enabled">
              独赢
            </el-checkbox>
            <el-checkbox v-model="form.totals" :disabled="!form.enabled">
              大小
            </el-checkbox>
            <el-checkbox v-model="form.spreads" :disabled="!form.enabled">
              让球
            </el-checkbox>
          </el-form-item>
        </div>
      </section>

      <section class="pod-bet-settings__section">
        <div class="pod-bet-settings__section-head">
          <h3>AutoYabo 策略</h3>
          <p>POD/NVP 是策略基准；OB/PM/RAY 只作为交易场馆执行，现有下单路径不在这里改写。</p>
        </div>
        <div class="pod-bet-settings__grid">
          <el-form-item label="最小降幅">
            <el-input-number
              v-model="form.minDropPct"
              :disabled="!form.enabled"
              :min="0"
              :max="80"
              :step="1"
              :precision="1"
              controls-position="right"
            />
            <span class="pod-bet-settings__unit">%</span>
          </el-form-item>
          <el-form-item label="EV 阈值">
            <el-input-number
              v-model="form.minObEdgePct"
              :disabled="!form.enabled"
              :min="0"
              :max="40"
              :step="0.5"
              :precision="1"
              controls-position="right"
            />
            <span class="pod-bet-settings__unit">% 高于 NVP</span>
          </el-form-item>
          <el-form-item label="赔率带">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.minOdds"
                :disabled="!form.enabled"
                :min="1.01"
                :max="20"
                :step="0.05"
                :precision="2"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">至</span>
              <el-input-number
                v-model="form.maxOdds"
                :disabled="!form.enabled"
                :min="1.05"
                :max="50"
                :step="0.05"
                :precision="2"
                controls-position="right"
              />
            </div>
          </el-form-item>
          <el-form-item label="冷票保护">
            <div class="pod-bet-settings__inline">
              <el-input-number
                v-model="form.maxAgeSec"
                :disabled="!form.enabled"
                :min="0"
                :max="600"
                :step="5"
                controls-position="right"
              />
              <span class="pod-bet-settings__unit">秒</span>
              <span class="pod-bet-settings__note">0 = 不限；只挡自动</span>
            </div>
          </el-form-item>
        </div>
        <div class="pod-bet-settings__yabo">
          <PodYaboSettings :form="form" />
        </div>
      </section>
    </el-form>
  </div>
</template>

<style scoped>
.pod-bet-settings {
  color: #0f172a;
}

.pod-bet-settings__form :deep(.el-form-item) {
  margin-bottom: 0;
}

.pod-bet-settings__form :deep(.el-input-number) {
  width: 120px;
}

.pod-bet-settings__section {
  padding: 14px 0 16px;
  border-top: 1px solid #e2e8f0;
}

.pod-bet-settings__section.is-top {
  padding-top: 0;
  border-top: 0;
}

.pod-bet-settings__section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.pod-bet-settings__section-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}

.pod-bet-settings__section-head p {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: #64748b;
}

.pod-bet-settings__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px 18px;
}

.pod-bet-settings__grid.is-two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.pod-bet-settings__inline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.pod-bet-settings__venue-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(240px, 1fr));
  align-items: start;
  gap: 12px;
  overflow-x: auto;
}

.pod-bet-settings__venue {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.pod-bet-settings__venue-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.pod-bet-settings__venue-head span {
  font-size: 13px;
  font-weight: 700;
}

.pod-bet-settings__venue-head small {
  min-width: 0;
  color: #64748b;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pod-bet-settings__rotation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px dashed #cbd5e1;
}

.pod-bet-settings__rotation > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pod-bet-settings__rotation strong {
  font-size: 12px;
  color: #334155;
}

.pod-bet-settings__rotation small {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
}

.pod-bet-settings__unit,
.pod-bet-settings__note {
  font-size: 12px;
  color: #64748b;
}

.pod-bet-settings__chip {
  padding: 2px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #fff;
  color: #334155;
  font-size: 12px;
  cursor: pointer;
}
.pod-bet-settings__chip.is-on,
.pod-bet-settings__chip:hover {
  color: #92400e;
  border-color: #f59e0b;
  background: #fffbeb;
}

.pod-bet-settings__yabo {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #cbd5e1;
}

@media (max-width: 760px) {
  .pod-bet-settings__grid.is-two {
    grid-template-columns: minmax(0, 1fr);
  }

  .pod-bet-settings__section-head {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
