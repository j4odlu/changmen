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
    ['import { hasRaySubmissionPreviews, observeRaySubmissionPreviews, readRaySubmissionPreviewOrders, retireRaySubmissionPreviews, resetRaySubmissionPreviews, setRaySubmissionPreviewWake } from "./submissionPreview";\n', ""],
    ['  retireRaySubmissionPreviews([...useOrderStore().orders.values()].flat());\n', ""],
    [`  const previewing = hasRaySubmissionPreviews(account);
  if (polling.has(player) || (account.active && !previewing) || (polledAt.has(player) && Date.now() - polledAt.get(player)! < RAY_ORDER_POLL_MS))`,
    '  if (polling.has(player) || account.active || (polledAt.has(player) && Date.now() - polledAt.get(player)! < RAY_ORDER_POLL_MS))'],
    ['  if (!previewing && !originals.size && !useRayOrderContextStore().activeTasks.some(task => task.accountId === player))',
    '  if (!originals.size && !useRayOrderContextStore().activeTasks.some(task => task.accountId === player))'],
    [`    const startedAt = Date.now();
    const previewOnly = account.active;
    const orders = previewOnly ? await readRaySubmissionPreviewOrders(account) : await readRayAccountOrders(account);
    if (current())
      observeRaySubmissionPreviews(account, orders, startedAt);
    if (previewOnly || !current() || account.active)
      return;`, '    const orders = await readRayAccountOrders(account);\n    if (!current() || account.active)\n      return;'],
    [`  setRaySubmissionPreviewWake((account) => {
    const current = useAccountStore().findAccount(account.accountId);
    if (timer && current === account) { polledAt.delete(account.accountId); pollAccount(current); }
  });\n`, ""],
    ['  resetRaySubmissionPreviews();\n', ""],
  ],
  [root + "components/order/OrderView.vue"]: [
    ['import { projectRaySubmissionPreviews } from "@/runtime/rayOrderMonitor/submissionPreview";\n', ""],
    [`const previewOrderEntries = computed(() => props.embedded ? mergedOrderEntries.value
  : projectRaySubmissionPreviews(mergedOrderEntries.value, orderDate.value, filterAccountId.value));
const displayOrderEntries = computed(() => props.projectOrderEntries?.(previewOrderEntries.value) ?? previewOrderEntries.value);`,
    'const displayOrderEntries = computed(() => props.projectOrderEntries?.(mergedOrderEntries.value) ?? mergedOrderEntries.value);'],
  ],
};

// [changmen 扩展] 仅反向还原预览角标，原预览源码哈希保持不变。
export function restoreRaySubmissionPreviewSource(file, source) {
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
  const file = root + "runtime/rayOrderMonitor/submissionPreview.ts";
  const source = restoreRaySubmissionPreviewSource(file, readSource(file)).replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(source).digest("hex"), "ddd0174700c9ab577c0bd4e5bada42e2a16e554648b108b57dde77161c889b3b",
    "complete RAY read-only preview implementation; no changes to rejection, persistence or shared snapshots");
  for (const entry of Object.keys(changes)) {
    assert(readSource(entry).includes("submissionPreview"), `${entry}: RAY preview entry is installed`);
    restoreRaySubmissionPreviewSource(entry, readSource(entry));
  }
  assert(readSource(file).includes('Status: "RayConfirming"'), "RAY preview only shows confirming before formal synchronization");
}
