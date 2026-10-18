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
    const orders = account.active ? await readRaySubmissionPreviewOrders(account) : await readRayAccountOrders(account);
    if (current())
      observeRaySubmissionPreviews(account, orders, startedAt);`, '    const orders = await readRayAccountOrders(account);'],
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

// [changmen 扩展] 仅反向还原确认状态展示增量，原预览源码哈希保持不变。
const confirmationChanges = {
  "client/web/src/runtime/rayOrderMonitor/submissionPreview.ts": [
    [
      "import type { ArbBetPlaced } from \"@/stores/betting/autoBet/phases/types\";\nimport type { ArbLegSettleSnapshot } from \"@/stores/betting/autoBet/phases/settleBothArbLegs\";\n",
      ""
    ],
    [
      "  confirmation?: { rejected: boolean; pending: boolean; checkedAt: number };\n",
      ""
    ],
    [
      "  const waitsForArbCheck = option.diagnosticAttempt === \"initial\" || option.diagnosticAttempt === \"retry\";\n",
      ""
    ],
    [
      "    previews.set(task.key, { account, current, task, matchId, itemId, previousIds, acceptedAt: Date.now(),\n      confirmation: waitsForArbCheck ? undefined : { rejected: false, pending: false, checkedAt: 0 } });\n",
      "    previews.set(task.key, { account, current, task, matchId, itemId, previousIds, acceptedAt: Date.now() });\n"
    ],
    [
      "  const known = new Map(rows.filter(row => row.Type === \"RAY\" && !row.DisplayOnly).map(row => [`${row.PlayerID}:${row.OrderID}`, row]));\n",
      "  const known = new Set(rows.filter(row => row.Type === \"RAY\" && !row.DisplayOnly).map(row => `${row.PlayerID}:${row.OrderID}`));\n"
    ],
    [
      "    const formal = preview.order && known.get(`${preview.account.accountId}:${preview.order.orderId}`);\n    if (!preview.current() || (preview.confirmation && !preview.confirmation.pending && formal\n      && (formal.Status === previewStatus(preview) || (!preview.confirmation.rejected && [\"Win\", \"Lose\", \"Return\"].includes(String(formal.Status))))))\n",
      "    if (!preview.current() || (preview.order && known.has(`${preview.account.accountId}:${preview.order.orderId}`)))\n"
    ],
    [
      "/** [changmen 扩展] 只接收原拒单检测结果供展示；不查询、不写回检测结果或业务订单。 */\nexport function finishRaySubmissionPreviewChecks(placed: Pick<ArbBetPlaced, \"linkId\" | \"accountA\" | \"accountB\" | \"legA\" | \"legB\">, settle: Pick<ArbLegSettleSnapshot, \"rejectA\" | \"rejectB\" | \"pendingConfirmA\" | \"pendingConfirmB\" | \"ordersA\" | \"ordersB\">): void {\n  try {\n    for (const preview of previews.values()) {\n      if (!preview.current() || preview.task.linkId !== placed.linkId)\n        continue;\n      const sideA = placed.accountA === preview.account && placed.legA.target === preview.task.target;\n      const sideB = placed.accountB === preview.account && placed.legB.target === preview.task.target;\n      if (sideA === sideB)\n        continue;\n      const rejected = sideA ? settle.rejectA : settle.rejectB;\n      const pending = sideA ? settle.pendingConfirmA : settle.pendingConfirmB;\n      const orders = sideA ? settle.ordersA : settle.ordersB;\n      const checked = orders.find(order => order.orderId === preview.order?.orderId);\n      const order = preview.order ? { ...preview.order, ...(checked || {}), status: rejected ? \"reject\" as const : checked?.status ?? \"none\" as const } : undefined;\n      previews.set(preview.task.key, { ...preview, order, confirmation: { rejected, pending, checkedAt: Date.now() } });\n    }\n  }\n  catch { /* 展示交接失败不能影响拒单检测、补单或原下注收尾。 */ }\n}\n\nfunction previewStatus(preview: Preview): OrderRow[\"Status\"] {\n  if (!preview.confirmation || preview.confirmation.pending)\n    return \"RayConfirming\";\n  return preview.confirmation.rejected ? \"Reject\" : preview.order!.status[0]!.toUpperCase() + preview.order!.status.slice(1);\n}\n\n",
      ""
    ],
    [
      "    if (startedAt < preview.acceptedAt || (preview.confirmation && startedAt <= preview.confirmation.checkedAt))\n",
      "    if (startedAt < preview.acceptedAt)\n"
    ],
    [
      "  // 正常同步可能早于拒单检测完成：只在投影里遮盖状态，原订单保持原样。\n  for (const preview of previews.values()) {\n    if (!preview.current() || !preview.order || (accountId && preview.account.accountId !== accountId))\n      continue;\n    for (const [link, rows] of result) {\n      const index = rows.findIndex(row => row.Type === \"RAY\" && row.PlayerID === preview.account.accountId && String(row.OrderID) === preview.order!.orderId);\n      if (index < 0)\n        continue;\n      if (preview.confirmation && !preview.confirmation.pending && !preview.confirmation.rejected\n        && [\"Win\", \"Lose\", \"Return\"].includes(String(rows[index]!.Status)))\n        continue;\n      const status = previewStatus(preview);\n      if (status !== rows[index]!.Status) {\n        rows[index] = { ...rows[index]!, DisplayOnly: true, Status: status };\n        result.set(link, rows); added = true;\n      }\n    }\n  }\n",
      ""
    ],
    [
      "      Money: order.money, CreateAt: order.createAt, Status: previewStatus(preview),\n",
      "      Money: order.money, CreateAt: order.createAt, Status: order.status[0]!.toUpperCase() + order.status.slice(1),\n"
    ]
  ],
  "client/web/src/stores/betting/autoBet/phases/finalizeArbBet.ts": [
    [
      "import { finishRaySubmissionPreviewChecks } from \"@/runtime/rayOrderMonitor/submissionPreview\";\n",
      ""
    ],
    [
      "  finishRaySubmissionPreviewChecks(placed, settle);\n",
      ""
    ]
  ]
};

export function restoreRaySubmissionPreviewSource(file, source) {
  if (confirmationChanges[file] && source.includes("finishRaySubmissionPreviewChecks")) {
    source = source.replaceAll("\r\n", "\n");
    for (const [added, original] of confirmationChanges[file]) {
      assert.equal(source.split(added).length, 2, `${file}: one exact RAY confirmation display extension`);
      source = source.replace(added, original);
    }
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
  for (const entry of Object.keys(confirmationChanges)) {
    assert(readSource(entry).includes("finishRaySubmissionPreviewChecks"), `${entry}: RAY confirmation display is installed`);
    restoreRaySubmissionPreviewSource(entry, readSource(entry));
  }
}
