<script setup lang="ts">
/**
 * [changmen 扩展] PM / PF 卖一缓冲 + PM FOK 深度。
 * PM 可选择原百分比或固定加 1 tick；由界面 Tab 保存到 Extensions 配置。
 */
import { storeToRefs } from "pinia";
import { computed } from "vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import { useUserStore } from "@/stores/userStore";

const { extensionPrefs } = storeToRefs(useUserStore());
const pmBufferMode = computed({
  get: () => extensionPrefs.value.pmArbPriceBuffer.mode ?? "percent",
  set: (value: "percent" | "tick") => { extensionPrefs.value.pmArbPriceBuffer.mode = value; },
});
</script>

<template>
  <section class="pm-pf-buffer" aria-label="PM / PF 深度和价格缓冲">
    <h3 class="pm-pf-buffer__heading">
      PM / PF 深度和价格缓冲
    </h3>
    <p class="pm-pf-buffer__note">
      对照查看；保存后写入 Extensions。PredictFun 无 FOK 深度项。
    </p>

    <div class="pm-pf-buffer__grid" role="group">
      <div class="pm-pf-buffer__corner" aria-hidden="true" />
      <div class="pm-pf-buffer__col-head">
        <PlatformIcon platform="Polymarket" />
        <span>Polymarket</span>
      </div>
      <div class="pm-pf-buffer__col-head">
        <PlatformIcon platform="PredictFun" />
        <span>PredictFun</span>
      </div>

      <el-tooltip
        placement="top"
        :show-after="200"
        popper-class="pm-pf-buffer-tip"
        content="缓冲用于展示赔率、套利计算和下单限价。结算仍用成交价。"
      >
        <span class="pm-pf-buffer__label">套利卖一缓冲</span>
      </el-tooltip>
      <el-tooltip
        placement="top"
        :show-after="200"
        popper-class="pm-pf-buffer-tip"
        content="百分比沿用原规则；加 1 tick 使用盘口实际 tick，限价 = 卖一 + tick，展示和套利赔率取其倒数。结算仍用成交价。"
      >
        <span class="pm-pf-buffer__ctrl">
          <el-switch
            v-model="extensionPrefs.pmArbPriceBuffer.enabled"
            inline-prompt
            active-text="开"
            inactive-text="关"
          />
        </span>
      </el-tooltip>
      <el-tooltip
        placement="top"
        :show-after="200"
        popper-class="pm-pf-buffer-tip"
        content="开：有 fo 的 PF 展示/扫描/限价 = 卖一 × 倍数。无 fo 不打折。已删除硬编码 30bps；关 = 裸限价。结算仍用成交价。"
      >
        <span class="pm-pf-buffer__ctrl">
          <el-switch
            v-model="extensionPrefs.pfArbPriceBuffer.enabled"
            inline-prompt
            active-text="开"
            inactive-text="关"
          />
        </span>
      </el-tooltip>

      <span class="pm-pf-buffer__label">缓冲方式</span>
      <el-radio-group
        v-model="pmBufferMode"
        class="pm-pf-buffer__mode"
        size="small"
        aria-label="PM 缓冲方式"
        :disabled="!extensionPrefs.pmArbPriceBuffer.enabled"
      >
        <el-radio value="percent">百分比</el-radio>
        <el-radio value="tick">加 1 tick</el-radio>
      </el-radio-group>
      <span class="pm-pf-buffer__na">百分比</span>

      <el-tooltip
        placement="top"
        :show-after="200"
        popper-class="pm-pf-buffer-tip"
        content="百分比：卖一乘以倍数，默认 1.01（1%）。加 1 tick：固定增加盘口实际的一档价格，元数据未就绪时暂不可下注。"
      >
        <span class="pm-pf-buffer__label">缓冲参数</span>
      </el-tooltip>
      <el-input-number
        v-if="pmBufferMode === 'percent'"
        v-model="extensionPrefs.pmArbPriceBuffer.multiplier"
        class="pm-pf-buffer__num"
        :min="1.01"
        :max="1.1"
        :step="0.01"
        :precision="2"
        :disabled="!extensionPrefs.pmArbPriceBuffer.enabled"
        controls-position="right"
      />
      <span v-else class="pm-pf-buffer__na">固定增加 1 tick</span>
      <el-input-number
        v-model="extensionPrefs.pfArbPriceBuffer.multiplier"
        class="pm-pf-buffer__num"
        :min="1.01"
        :max="1.1"
        :step="0.01"
        :precision="2"
        :disabled="!extensionPrefs.pfArbPriceBuffer.enabled"
        controls-position="right"
      />

      <el-tooltip
        placement="top"
        :show-after="200"
        popper-class="pm-pf-buffer-tip"
        content="开：成交价及更优档可立即成交额须 ≥ 下单金额 × 倍数，否则预检失败。关 = 现网 1×。更深更差档不算垫。"
      >
        <span class="pm-pf-buffer__label">FOK 深度倍数</span>
      </el-tooltip>
      <el-switch
        v-model="extensionPrefs.pmFokDepthBuffer.enabled"
        inline-prompt
        active-text="开"
        inactive-text="关"
      />
      <span class="pm-pf-buffer__na">—</span>

      <el-tooltip
        placement="top"
        :show-after="200"
        popper-class="pm-pf-buffer-tip"
        content="成交价及更优档深度须达到下单金额的该倍数。默认 1.5；保存后写入 Extensions。"
      >
        <span class="pm-pf-buffer__label">深度倍数</span>
      </el-tooltip>
      <el-input-number
        v-model="extensionPrefs.pmFokDepthBuffer.multiplier"
        class="pm-pf-buffer__num"
        :min="1.1"
        :max="10"
        :step="0.1"
        :precision="1"
        :disabled="!extensionPrefs.pmFokDepthBuffer.enabled"
        controls-position="right"
      />
      <span class="pm-pf-buffer__na">—</span>
    </div>
  </section>
</template>

<style scoped>
.pm-pf-buffer {
  margin: 0 0 16px;
  padding: 14px 16px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  box-sizing: border-box;
}

.pm-pf-buffer__heading {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--el-text-color-primary);
}

.pm-pf-buffer__note {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.pm-pf-buffer__grid {
  display: grid;
  overflow-x: auto;
  grid-template-columns: minmax(118px, 1.05fr) minmax(148px, 1fr) minmax(148px, 1fr);
  column-gap: 12px;
  row-gap: 10px;
  align-items: center;
}

.pm-pf-buffer__col-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pm-pf-buffer__col-head :deep(.provider-icon) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.pm-pf-buffer__label {
  display: inline-block;
  cursor: help;
  border-bottom: 1px dashed var(--el-border-color);
  font-size: 13px;
  line-height: 1.3;
  color: var(--el-text-color-regular);
}

.pm-pf-buffer__ctrl {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
}

.pm-pf-buffer__num {
  width: 120px;
}

.pm-pf-buffer__mode {
  gap: 0 12px;
}

.pm-pf-buffer__mode :deep(.el-radio) {
  margin-right: 0;
}

.pm-pf-buffer__na {
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  line-height: 32px;
}

@media (max-width: 900px) {
  .pm-pf-buffer__grid {
    grid-template-columns: minmax(110px, 1fr) minmax(128px, 1fr) minmax(128px, 1fr);
  }
}
</style>

<style>
.pm-pf-buffer-tip {
  max-width: 360px;
  line-height: 1.5;
  white-space: normal;
}
</style>
