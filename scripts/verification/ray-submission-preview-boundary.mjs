// [changmen 扩展] 仅还原 RAY 提交后只读预览的精确接入；原拒单检测及固定 FOK 基线继续完整核对。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = "client/web/src/";
const changes = {
  [root + "runtime/providers.ts"]: [
    ['import { beginRaySubmissionPreview } from "./rayOrderMonitor/submissionPreview";\n', ""],
    [`wrapper = { ...provider, betting(account, option) {
      let accept: ReturnType<typeof beginRaySubmissionPreview>;
      try { accept = beginRaySubmissionPreview(account, option); }
      catch { /* 提前展示登记失败不阻断原下注。 */ }
      return provider.betting.call(provider, account, option).then((result) => {
        try { accept?.(result); }
        catch { /* 提前展示不改变原回执。 */ }
        return result;
      });
    }, getOrders(account) {`, 'wrapper = { ...provider, getOrders(account) {'],
  ],
  [root + "runtime/rayOrderMonitor/runtime.ts"]: [
    ['import { startRaySubmissionPreviewPolling, stopRaySubmissionPreviewPolling } from "./submissionPreviewPolling";\n\n', ""],
    ['  startRaySubmissionPreviewPolling();\n', ""],
    ['  stopRaySubmissionPreviewPolling();\n', ""],
  ],
  [root + "components/order/OrderView.vue"]: [
    ['import { projectRaySubmissionPreviews } from "@/runtime/rayOrderMonitor/submissionPreview";\n', ""],
    [`const previewOrderEntries = computed(() => props.embedded ? mergedOrderEntries.value
  : projectRaySubmissionPreviews(mergedOrderEntries.value, orderDate.value, filterAccountId.value));
const displayOrderEntries = computed(() => props.projectOrderEntries?.(previewOrderEntries.value) ?? previewOrderEntries.value);`,
    'const displayOrderEntries = computed(() => props.projectOrderEntries?.(mergedOrderEntries.value) ?? mergedOrderEntries.value);'],
  ],
};

// [changmen 扩展] 精确还原展示调度拆分及角标；原预览和业务监控的固定哈希保持不变。
export function restoreRaySubmissionPreviewSource(file, source) {
  if (file === root + "runtime/rayOrderMonitor/submissionPreview.ts") {
    source = source.replaceAll("\r\n", "\n");
    for (const [added, original] of [
      [
        "import { observedRayOrders }",
        "import { getProvider } from \"@/runtime/venueAdapters\";\nimport { observedRayOrders }"
      ],
      [
        "export function pendingRaySubmissionPreviewAccounts(): PlatformAccount[] {\n  return [...new Set([...previews.values()].filter(preview => !preview.order && preview.current()).map(preview => preview.account))];\n}\n\n",
        "export function hasRaySubmissionPreviews(account: PlatformAccount): boolean {\n  return [...previews.values()].some(preview => preview.account === account && preview.current());\n}\n\n"
      ],
      [
        "function sameText",
        "/** 预览查询直接读 adapter，不向 GTC/拒单检测共享的事实快照发布提前结果。 */\nexport async function readRaySubmissionPreviewOrders(account: PlatformAccount): Promise<VenueOrder[]> {\n  return await getProvider(account)?.getOrders?.(account) ?? [];\n}\n\nfunction sameText"
      ],
      [
        "  const claimed = new Set(owned.map(preview => preview.order?.orderId).filter(Boolean));\n",
        ""
      ],
      [
        "    const candidates = orders.filter(order =>",
        "    const claimed = new Set(owned.filter(other => other !== preview).map(other => other.order?.orderId).filter(Boolean));\n    const candidates = orders.filter(order =>"
      ],
      [
        "    if (preview.order || startedAt < preview.acceptedAt)",
        "    if (startedAt < preview.acceptedAt)"
      ],
      [
        "    if (matched.kind === \"matched\") {\n      claimed.add(matched.candidate.order.orderId);\n      previews.set(preview.task.key, { ...preview, order: { ...matched.candidate.order } });\n    }",
        "    const order = preview.order ? candidates.find(order => order.orderId === preview.order!.orderId)\n      : matched.kind === \"matched\" ? matched.candidate.order : undefined;\n    if (order) {\n      // 慢响应不能把已观察到的终态回退为未结算。\n      const terminal = preview.order && [\"win\", \"lose\", \"return\", \"reject\"].includes(preview.order.status);\n      previews.set(preview.task.key, { ...preview, order: terminal ? preview.order : { ...order } });\n    }"
      ]
    ]) {
      assert.equal(source.split(added).length, 2, "one exact independent preview change");
      source = source.replace(added, original);
    }
  }
  if (file === root + "runtime/rayOrderMonitor/submissionPreview.ts" && source.includes('Status: "RayConfirming"')) {
    const added = '      Money: order.money, CreateAt: order.createAt, Status: "RayConfirming",';
    assert.equal(source.split(added).length, 2, "one exact RAY confirming preview label");
    source = source.replace(added, '      Money: order.money, CreateAt: order.createAt, Status: order.status[0]!.toUpperCase() + order.status.slice(1),');
  }
  if (!changes[file] || !source.includes("submissionPreview")) return source;
  source = source.replaceAll("\r\n", "\n");
  for (const [added, original] of changes[file]) {
    assert.equal(source.split(added).length, 2, `${file}: one exact RAY read-only preview extension`);
    source = source.replace(added, original);
  }
  return source;
}

export function verifyRaySubmissionPreviewSources(readSource) {
  const poller = root + "runtime/rayOrderMonitor/submissionPreviewPolling.ts";
  assert.equal(createHash("sha256").update(readSource(poller).replaceAll("\r\n", "\n")).digest("hex"), "eb5527a9639e66d58ee46b46bd7ddc08ef6ab0429754b2691e5666b23375a4af",
    "complete independent display poller; raw reads only, no business monitoring effects");
  const file = root + "runtime/rayOrderMonitor/submissionPreview.ts";
  const source = restoreRaySubmissionPreviewSource(file, readSource(file)).replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(source).digest("hex"), "ddd0174700c9ab577c0bd4e5bada42e2a16e554648b108b57dde77161c889b3b",
    "complete RAY read-only preview implementation; no changes to rejection, persistence or shared snapshots");
  for (const entry of Object.keys(changes)) {
    assert(readSource(entry).toLowerCase().includes("submissionpreview"), `${entry}: RAY preview entry is installed`);
    restoreRaySubmissionPreviewSource(entry, readSource(entry));
  }
  assert(readSource(file).includes('Status: "RayConfirming"'), "RAY preview only shows confirming before formal synchronization");
}
