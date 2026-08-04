import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ORG_ROOT = path.resolve(TEST_ROOT, "..");
const SKILL_ROOT = path.join(ORG_ROOT, "skills", "brand-positioning");
const SKILL_PATH = path.join(SKILL_ROOT, "SKILL.md");
const AGENT_PATH = path.join(SKILL_ROOT, "agents", "openai.yaml");
const CONTRACT_PATH = path.join(
  SKILL_ROOT,
  "references",
  "deliverable-contract.md",
);
const TEMPLATE_PATH = path.join(
  SKILL_ROOT,
  "assets",
  "positioning-brief-template.md",
);

async function readRequired(targetPath) {
  const body = await fs.readFile(targetPath, "utf8");
  assert.ok(body.trim().length > 0, `${targetPath} must be non-empty`);
  return body;
}

test("brand positioning skill has a discoverable, complete structure", async () => {
  const [skill, agent, contract, template] = await Promise.all([
    readRequired(SKILL_PATH),
    readRequired(AGENT_PATH),
    readRequired(CONTRACT_PATH),
    readRequired(TEMPLATE_PATH),
  ]);

  assert.match(skill, /^---\r?\nname: brand-positioning\r?\n/u);
  assert.match(skill, /description: Use when /u);
  assert.match(agent, /display_name: "品牌定位"/u);
  assert.match(agent, /default_prompt: ".*\$brand-positioning/u);
  assert.match(contract, /品牌定位陈述/u);
  assert.match(template, /证据与未知项/u);
});

test("skill defines inputs, execution, outputs, quality, retry, stop, example, and version", async () => {
  const skill = await readRequired(SKILL_PATH);
  for (const heading of [
    "输入",
    "执行",
    "输出与验收",
    "异常、重试与停止",
    "示例",
    "版本",
  ]) {
    assert.match(skill, new RegExp(`## ${heading}`, "u"));
  }
});

test("skill locks the evidence-first positioning method and business boundaries", async () => {
  const skill = await readRequired(SKILL_PATH);
  const required = [
    /飞书知识/u,
    /对话补充/u,
    /互联网公开检索/u,
    /no_hit/u,
    /degraded/u,
    /事实、推断、假设和未知/u,
    /品类定位/u,
    /使用者、决策者和付款者/u,
    /非首要用户/u,
    /实际替代/u,
    /差异化/u,
    /证据/u,
    /一个主要心智/u,
    /品牌架构/u,
    /商标.*不能|不能.*商标/u,
    /品牌视觉/u,
    /品牌传播/u,
    /operational/u,
    /acceptsFormalTasks/u,
    /不得.*outputs/u,
  ];
  for (const pattern of required) assert.match(skill, pattern);
});

test("deliverable contract rejects generic positioning and unsupported claims", async () => {
  const contract = await readRequired(CONTRACT_PATH);
  for (const pattern of [
    /高品质/u,
    /专业/u,
    /创新/u,
    /年轻人/u,
    /多个.*心智|多.*心智/u,
    /证据不足/u,
    /待验证/u,
    /名称.*预查/u,
  ]) {
    assert.match(contract, pattern);
  }
});

test("skill references root capabilities without copying them into the core skill", async () => {
  const skill = await readRequired(SKILL_PATH);
  assert.match(
    skill,
    /shared\/FEISHU_KNOWLEDGE_PREFLIGHT_STANDARD\.md/u,
  );
  assert.doesNotMatch(skill, /淘宝电商套图.*核心技能/u);
  assert.doesNotMatch(skill, /普通宣传海报.*核心技能/u);
});
