import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ORG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(ORG, "skills", "brand-communication");
const paths = {
  skill: path.join(ROOT, "SKILL.md"),
  agent: path.join(ROOT, "agents", "openai.yaml"),
  contract: path.join(ROOT, "references", "deliverable-contract.md"),
  template: path.join(ROOT, "assets", "communication-brief-template.md"),
};
async function read(p) {
  const value = await fs.readFile(p, "utf8");
  assert.ok(value.trim());
  return value;
}

test("brand communication skill is discoverable and complete", async () => {
  const [skill, agent, contract, template] = await Promise.all(
    Object.values(paths).map(read),
  );
  assert.match(skill, /^---\r?\nname: brand-communication\r?\n/u);
  assert.match(skill, /description: Use when /u);
  assert.match(agent, /display_name: "品牌传播"/u);
  assert.match(agent, /\$brand-communication/u);
  assert.match(contract, /品牌信息体系/u);
  assert.match(template, /增长战略官简报/u);
  assert.match(template, /AI成交官简报/u);
});

test("skill defines inputs, execution, output, retry, stop, example and version", async () => {
  const skill = await read(paths.skill);
  for (const heading of ["输入", "执行", "输出与验收", "异常、重试与停止", "示例", "版本"]) {
    assert.match(skill, new RegExp(`## ${heading}`, "u"));
  }
});

test("skill covers brand narrative while preserving the growth boundary", async () => {
  const skill = await read(paths.skill);
  for (const pattern of [
    /自动读取.*品牌定位/u,
    /视觉规范/u,
    /品牌信息体系/u,
    /内容母题/u,
    /品牌故事/u,
    /创始人IP/u,
    /传播战役/u,
    /品牌一致性/u,
    /事实证据/u,
    /增长战略官/u,
    /AI成交官/u,
    /短视频/u,
    /小红书/u,
    /私域/u,
    /日常.*运营/u,
    /投放/u,
    /operational/u,
    /不得.*outputs/u,
  ]) assert.match(skill, pattern);
  assert.doesNotMatch(
    skill,
    /把.{0,80}成交(?:话术|脚本|执行).{0,20}交给增长战略官/u,
  );
  assert.doesNotMatch(
    skill,
    /增长战略官负责[^；。\r\n]*(?:成交话术|成交脚本|成交执行)/u,
  );
});

test("contract rejects invented stories, guarantees and channel-operation takeover", async () => {
  const contract = await read(paths.contract);
  for (const pattern of [
    /虚构/u,
    /第一/u,
    /保证/u,
    /创始人/u,
    /证据/u,
    /日更/u,
    /投流/u,
    /获客/u,
    /成交/u,
    /增长战略官/u,
    /AI成交官/u,
  ]) assert.match(contract, pattern);
});
