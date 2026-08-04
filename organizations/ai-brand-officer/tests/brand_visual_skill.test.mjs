import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ORG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(ORG_ROOT, "..", "..");
const ROOT = path.join(ORG_ROOT, "skills", "brand-visual");
const PUBLIC_SKILLS_REGISTRY = path.join(
  PROJECT_ROOT,
  "public-skills",
  "registry.json",
);
const files = {
  skill: path.join(ROOT, "SKILL.md"),
  agent: path.join(ROOT, "agents", "openai.yaml"),
  contract: path.join(ROOT, "references", "deliverable-contract.md"),
  template: path.join(ROOT, "assets", "visual-strategy-template.md"),
};

async function read(target) {
  const value = await fs.readFile(target, "utf8");
  assert.ok(value.trim());
  return value;
}

function decidePublicCapability(entry) {
  return (
    entry.maturity === "operational"
    && entry.allowedOrganizations.includes("ai-brand-officer")
  );
}

test("brand visual skill has complete discoverable resources", async () => {
  const [skill, agent, contract, template] = await Promise.all(
    Object.values(files).map(read),
  );
  assert.match(skill, /^---\r?\nname: brand-visual\r?\n/u);
  assert.match(skill, /description: Use when /u);
  assert.match(agent, /display_name: "品牌视觉"/u);
  assert.match(agent, /\$brand-visual/u);
  assert.match(contract, /视觉策略/u);
  assert.match(template, /参考视觉DNA/u);
});

test("skill contains the full operational contract", async () => {
  const skill = await read(files.skill);
  for (const heading of ["输入", "执行", "输出与验收", "异常、重试与停止", "示例", "版本"]) {
    assert.match(skill, new RegExp(`## ${heading}`, "u"));
  }
  for (const pattern of [
    /已确认.*品牌定位/u,
    /最小定位检查/u,
    /三个.*方向/u,
    /参考视觉DNA/u,
    /构图.*光线.*色彩.*字体.*材质.*留白/u,
    /Logo/u,
    /门店/u,
    /包装/u,
    /施工图/u,
    /法规/u,
    /产品身份指纹/u,
    /SHA-256/u,
    /确定性排版/u,
    /品牌一致性总审/u,
    /operational/u,
    /不得.*outputs/u,
  ]) assert.match(skill, pattern);
});

test("skill references public production capabilities without duplicating them", async () => {
  const skill = await read(files.skill);
  const registryBytes = await fs.readFile(PUBLIC_SKILLS_REGISTRY);
  const registry = JSON.parse(registryBytes.toString("utf8"));
  const poster = registry.publicSkills.find(
    ({ id }) => id === "public.promotional-poster",
  );
  const taobao = registry.publicSkills.find(
    ({ id }) => id === "public.taobao-ecommerce-image-set",
  );
  assert.ok(poster);
  assert.ok(taobao);
  assert.equal(registry.version, undefined);
  assert.match(
    createHash("sha256").update(registryBytes).digest("hex"),
    /^[a-f0-9]{64}$/u,
  );
  assert.match(skill, /skills\/creating-promotional-posters\/SKILL\.md/u);
  assert.match(skill, /workflows\/TAOBAO_ECOMMERCE_IMAGE_SET_PILOT\.md/u);
  assert.match(skill, /public-skills\/registry\.json/u);
  assert.match(skill, /public\.promotional-poster/u);
  assert.match(skill, /public\.taobao-ecommerce-image-set/u);
  assert.match(skill, /maturity.*operational/su);
  assert.match(skill, /allowedOrganizations.*ai-brand-officer/su);
  assert.doesNotMatch(skill, /根登记为 `formal`|仍为 `pilot` 公共能力/u);
  assert.match(skill, /不计入.*核心技能/u);
  assert.equal(poster.maturity, "operational");
  assert.equal(taobao.maturity, "pilot");
  assert.equal(decidePublicCapability(poster), true);
  assert.equal(decidePublicCapability(taobao), false);
  assert.equal(decidePublicCapability({ ...poster, maturity: "pilot" }), false);
  assert.equal(decidePublicCapability({ ...taobao, maturity: "operational" }), true);
});

test("visual contract rejects generic style and unsupported production claims", async () => {
  const contract = await read(files.contract);
  for (const pattern of [
    /高级/u,
    /黑金/u,
    /字体授权/u,
    /AI生成/u,
    /正式Logo/u,
    /商标/u,
    /概念效果图/u,
    /施工/u,
    /包装.*法规/u,
    /系列.*一致性/u,
  ]) assert.match(contract, pattern);
});
