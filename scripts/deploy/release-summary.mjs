// [changmen 扩展] Diagnostics only; never authorizes publication or prints logs/secrets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supplementalReports, assertSupplemental } from "./acceptance-contract.mjs";
const cell = value => String(value ?? "—").replaceAll(/[`<>|\r\n]/g, " ").slice(0, 160);
export function releaseSummary({ root = process.cwd(), commit = process.env.GITHUB_SHA, status = process.env.ACCEPTANCE_JOB_STATUS } = {}) {
  const read = name => { try { return JSON.parse(fs.readFileSync(path.join(root, name), "utf8")); } catch { return null; } };
  const report = read("output/change-validation/verdict.json"), plan = report?.plan ?? read("output/change-validation/plan.json");
  const seal = read("output/release-validation/evidence.json");
  const sealed = seal && seal.commit === report?.identity?.commit && seal.inputFingerprint === report?.identity?.inputFingerprint
    && seal.planFingerprint === report?.planFingerprint;
  let accepted = report?.passed === true && report?.sourceStable === true
    && report.results?.every(row => row.passed === true) && sealed && (!commit || report.identity?.commit === commit);
  const rows = (report?.results ?? []).map(row => `| ${cell(row.check)} | ${row.passed ? "PASS" : "FAIL"} | ${cell(row.elapsedMs)} | ${row.reusedFrom ? `完整审计 / ${cell(row.reusedFrom.phase)}` : "直接执行"} |`), failures = [];
  for (const row of report?.results ?? []) if (!row.passed)
    failures.push(`${cell(row.check)}: exit=${cell(row.exitCode)}, error=${cell(row.errorCode)}, signal=${cell(row.signal)}${row.diagnostic ? `, ${cell(row.diagnostic)}` : ""}`);
  for (const required of plan?.requiredChecks ? supplementalReports(plan) : []) {
    const proof = read(required.source);
    try { if (!report) throw Error("Missing component report"); assertSupplemental(proof, required.kind, report); }
    catch { accepted = false; failures.push(`${required.kind}: 缺失、失败或提交/输入不匹配`); }
    for (const phase of proof?.results ?? []) if (!phase.passed)
      failures.push(`${required.kind}/${cell(phase.phase)} (exit=${cell(phase.exitCode)}, ${cell(phase.elapsedMs)}ms)`);
  }
  if (!report) failures.push("未产生验收报告：检查安装、计划或执行步骤的日志。");
  if (!sealed) failures.push("未取得与本次验收一致的封包证据。");
  if (report && commit && report.identity?.commit !== commit) failures.push("验收报告提交与本次工作流不一致。");
  if (report?.sourceStable === false) failures.push("检查期间源码发生变化。");
  if (status && status !== "success") { accepted = false; failures.push(`工作流状态 ${cell(status)}；检查封包、上传或之前失败的步骤。`); }
  return `## 发布验收\n\n- 提交：${cell(commit ?? report?.identity?.commit)}\n- 范围：${cell(plan?.deployment?.scope)}\n- 顺序：${plan?.deployment?.backendFirst ? "backend → frontend" : "按组件计划"}\n- 本任务验收及封包：${accepted ? "通过，发布仍受后续任务控制" : "未通过，不能据此放行"}\n- FOK 专项：独立按需执行；数据库兼容必需：${cell(plan?.requiredChecks?.databaseCompatibility)}\n\n| 检查 | 结果 | 毫秒 | 证据来源 |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n${failures.map(row => `- ${row}`).join("\n")}\n\n报告和各阶段日志见本次工作流验收附件；缺失检查不视为通过。\n`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = releaseSummary();
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);
}
