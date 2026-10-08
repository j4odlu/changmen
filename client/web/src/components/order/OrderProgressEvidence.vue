<script setup lang="ts">
import type { ProgressProof } from "@changmen/shared/order_progress_evidence";
import { observationEventStage } from "@changmen/shared/order_observation_view";

/** [changmen 扩展] 仅展示只读证据，不触发场馆查询、重试或状态写入。 */
defineProps<{ proof?: ProgressProof }>();
function time(at: number) { return new Date(at).toLocaleString("zh-CN", { hour12: false }); }
</script>

<template>
  <details class="active-bet-run__evidence">
    <summary>查看依据</summary>
    <p v-if="!proof || proof.missing">本行尚无直接证据；当前文字为编排提示或记录缺失提示，不能据此认定场馆成交或未成交。</p>
    <template v-if="proof">
      <p class="active-bet-run__evidence-rule">判定规则 {{ proof.rule }} · v{{ proof.ruleVersion }}</p>
      <ul>
        <li v-for="event in proof.events" :key="`${event.ownerUserId}:${event.eventId}`">
          <strong>原始{{ observationEventStage(event) }}记录</strong>
          <dl>
            <dt>来源</dt><dd>客户端上报 · {{ event.source || '未记录' }}</dd>
            <dt>原记录结果</dt><dd>{{ event.outcome || '未记录' }}</dd>
            <dt>发生时间</dt><dd>{{ time(event.occurredAt) }}</dd>
            <dt>服务端接收</dt><dd>{{ event.receivedAt ? time(event.receivedAt) : '当前记录未提供服务端接收时间' }}</dd>
            <dt>记录编号</dt><dd>{{ event.eventId }}</dd>
            <dt>完整 Link</dt><dd>{{ event.linkId }}</dd>
            <template v-if="event.executionId"><dt>执行编号</dt><dd>{{ event.executionId }}</dd></template>
            <template v-if="event.attemptId"><dt>尝试编号</dt><dd>{{ event.attemptId }}</dd></template>
            <template v-if="event.queueId"><dt>队列编号</dt><dd>{{ event.queueId }}</dd></template>
            <template v-if="event.provider"><dt>平台 / 账号</dt><dd>{{ event.provider }} / {{ event.accountId ?? '未记录' }}</dd></template>
            <template v-if="event.orderId"><dt>订单号</dt><dd>{{ event.orderId }}</dd></template>
            <template v-if="event.observedStatus"><dt>原记录状态</dt><dd>{{ event.observedStatus }}</dd></template>
            <template v-if="event.odds !== undefined"><dt>记录赔率</dt><dd>@{{ event.odds }}</dd></template>
            <template v-if="event.amount !== undefined"><dt>记录金额</dt><dd>{{ event.amount }} {{ event.currency || '币种未记录' }}</dd></template>
            <template v-if="event.reasonCode"><dt>原因代码</dt><dd>{{ event.reasonCode }}</dd></template>
            <template v-if="event.safeSummary"><dt>记录说明</dt><dd>{{ event.safeSummary }}</dd></template>
          </dl>
        </li>
        <li v-for="record in proof.records" :key="`${record.provider}:${record.accountId}:${record.orderId}`">
          <strong>当前订单记录 · {{ record.status }}</strong>
          <p>此为本次展示读取的订单状态，未提供状态更新时间和历史版本；不能代表上方回执发生时的状态。</p>
          <dl>
            <dt>平台 / 账号</dt><dd>{{ record.provider }} / {{ record.accountId ?? '未记录' }}</dd>
            <dt>订单号</dt><dd>{{ record.orderId }}</dd>
            <dt>完整 Link</dt><dd>{{ record.linkId ?? '未记录' }}</dd>
            <template v-if="record.shares !== undefined"><dt>记录份额</dt><dd>{{ record.shares }}</dd></template>
          </dl>
        </li>
      </ul>
    </template>
  </details>
</template>
