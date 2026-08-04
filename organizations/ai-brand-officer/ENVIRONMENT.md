# 品AI品牌官｜已验证环境

## 1. 记录原则

本文件只记录实际验证结果，不把计划、推断或未运行入口写成可用能力。当前工作区为 Windows PowerShell、非 Git 根工作区。

三个核心 Skill v2 的本地运行与测试依赖为 Node.js 24 ESM、`node:test`、JSON Schema 2020-12 和 Windows PowerShell 5.1。无需建立 Git 仓库或外部项目。

## 2. 三个核心 Skill v2 验证入口

原三个 Skill 与集成边界回归：

```powershell
node --test organizations/ai-brand-officer/tests/brand_positioning_skill.test.mjs organizations/ai-brand-officer/tests/brand_visual_skill.test.mjs organizations/ai-brand-officer/tests/brand_communication_skill.test.mjs organizations/ai-brand-officer/tests/three_core_skills_integration.test.mjs
```

全部 AI品牌官 Node 测试：

```powershell
node --test organizations/ai-brand-officer/tests/*.test.mjs
```

组织边界和根项目完整性：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File organizations/ai-brand-officer/scripts/check_scope_guard.ps1
scripts/project_self_check.bat --no-pause
```

这些命令的本轮真实结果记录在 `temp/skill-evals/core-skills-v2-verification.md`；该凭证只证明候选实现与自动化检查状态，不代表正式接单或外部发布。

## 3. 早期实际验证

### 起始范围守卫

执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File organizations/ai-brand-officer/scripts/check_scope_guard.ps1
```

本次 Task3 开始前实际结果：退出码 `0`，输出 `PASS: protected root paths unchanged.`。

### 文档契约 RED

执行：

```powershell
node --test organizations/ai-brand-officer/tests/organization_docs.test.mjs
```

文档实现前实际结果：共 34 项，21 项通过、13 项失败；失败原因是 Task3 要求的组织文档尚不存在。章程临时副本的退化夹具已经通过，未修改真实章程。

### 文档契约 GREEN

补齐文档后再次执行同一命令，实际结果：34/34 通过、0 项失败。

### Task1 + Task2 + Task3 联合回归

执行：

```powershell
node --test organizations/ai-brand-officer/tests/organization_scope_guard.test.mjs organizations/ai-brand-officer/tests/protected_root_rebaseline.test.mjs organizations/ai-brand-officer/tests/organization_config.test.mjs organizations/ai-brand-officer/tests/organization_docs.test.mjs
```

实际结果：65/65 通过、0 项失败。

### 根项目自检历史兼容缺口与当前结果

执行：

```powershell
scripts/project_self_check.bat --no-pause
```

历史首次运行曾退出 `1`；该兼容缺口随后由根级 `ISSUE-0040` 修复并关闭。当前正式凭证是 `temp/control-center/project-self-check-reviews/20260728-ai-brand-officer-task3/review-result.json`：根自检通过 72 个文件、10 个目录、0 个问题，且 53 类伪装导航退化测试均被拒绝。组织导航继续只引用根级唯一事实源。

### Task3 质量修复 RED/GREEN

新增根注册表直读、逐文件成熟度门槛和等价虚假声明退化测试后，首次实际结果为 38 项中 34 项通过、4 项失败；失败点对应旧文档缺少根门槛、把 `pilot` 与根成熟度混淆、验收可能直达正式资产、组织导航复述历史正文。完成修复后再次执行，实际结果为 38/38 通过、0 项失败。

### Task4 三个核心 Skill RED/GREEN 与独立评测

- 品牌定位 Skill：实现前单项测试 0/5，通过创建完整 Skill、交付契约、模板和调用说明后为 5/5；结构校验通过。
- 品牌视觉 Skill：实现前单项测试 0/4，完成后为 4/4；结构校验通过。
- 品牌传播 Skill：实现前单项测试 0/4，完成后为 4/4；结构校验通过。
- 三 Skill 集成：状态登记前 1/2 通过、1 项因视觉和传播仍为 `designed_not_implemented` 失败；统一登记为组织侧 `pilot` 后为 2/2。
- 建设过程中曾取得全部组织测试 84/84 通过；最终修改后的 Task4 相关测试为 67/67 通过，三个 Skill 结构校验均为有效。
- 根项目自检：72 个文件、10 个目录、0 个问题。
- 独立评测文件：`temp/skill-evals/brand-positioning-with-skill.md`、`brand-visual-with-skill.md`、`brand-communication-with-skill.md`；均保留在候选区，未写入 `outputs/`。

本轮结束时只读范围守卫同时检测到根控制中心正在建设的项目合同与存储脚本发生变化。最终全组织回归因此为 83/84：唯一失败发生在范围测试运行期间真实根文件继续变化，哈希前后不一致；Task4 自身 67/67 仍通过。该漂移位于本组织权限范围外，已按范围守卫真实报告；本组织没有重建根基线，也不把该外部状态描述成三个 Skill 的失败或根连接完成。

## 4. 根控制中心审查凭证

正式凭证位于：

`temp/control-center/protected-root-baseline-reviews/20260728-ai-brand-officer-task1/review-result.json`

凭证记录的实际验证为：

- 品牌官边界测试：17/17；
- 根级顺序测试：816/816；
- 项目自检：72 个文件、10 个目录、0 个问题；
- 审查后范围守卫：退出码 0，连续通过 3 次；
- 旧快照 SHA-256：`76519e2eba634a7a8f6ce529d241c157b7962895668a1135b5eb58b900e0f2bb`；
- 新快照 SHA-256：`d37f97367170847873d3c607a451922aade9a2c5be03aaaba95f1e6dd7887ec3`；
- 旧快照完整备份：`temp/control-center/protected-root-baseline-reviews/20260728-ai-brand-officer-task1/protected-root-files.old-76519e2e.json`。

这些结果只证明根控制中心完成了对应范围审查并解除门禁，不代表本组织获得新的根权限。

## 5. 当前连接状态

- `rootControllerRegistration = registered_designing`
- `peerOrganizationCalls = contract_only`
- 根组织状态：`status = designing`
- 根正式任务状态：`acceptsFormalTasks = false`
- 根三个核心技能状态：均为 `designing`
- 品牌定位组织配置：`pilot`，仅为组织侧候选验证成熟度
- 品牌视觉组织配置：`pilot`，仅为组织侧候选验证成熟度
- 品牌传播组织配置：`pilot`，仅为组织侧候选验证成熟度
- 飞书知识写回：`disabled`

根运行登记当前已经为 AI品牌官绑定 `configPath`，并把品牌定位、品牌视觉、品牌传播三个 Skill 标记为可加载；因此本地登记使用 `registered_designing`。组织配置成熟度不等于根权威成熟度。在根状态升级为 `operational` 且 `acceptsFormalTasks = true` 前，只能形成候选与验证证据；不得正式接单、正式晋级或写入 `outputs/` 正式成果。组织侧 rebaseline 永久拒绝。

## 6. 2026-07-29 统一质量整改验证

### 质量契约 RED

在三个独立 Workflow、统一质量档案和本地登记更新前执行：

```powershell
node --test organizations/ai-brand-officer/tests/organization_quality_standard.test.mjs organizations/ai-brand-officer/tests/organization_config.test.mjs organizations/ai-brand-officer/tests/three_core_skills_integration.test.mjs organizations/ai-brand-officer/tests/organization_docs.test.mjs
```

实际结果：58 项中 50 项通过、8 项失败。失败原因与预期一致：三个专项 Workflow 和 `quality/organization-quality.json` 尚不存在，本地配置、Schema 和文档仍为历史 `not_connected`。

### 质量契约 GREEN

完成最小实现后再次执行同一命令，实际结果：58/58 通过、0 项失败。

### 组织自身稳定回归

外部并发新增的证据引擎实现落盘后，执行除受保护根并发漂移长测以外的全部组织测试，实际结果：157/157 通过、0 项失败。根运行登记实读结果为：

- `rootStatus = designing`
- `rootAcceptsFormalTasks = false`
- `localRootControllerRegistration = registered_designing`
- `warnings = []`
- 三个 Skill 均为 `availability = available`

较早一次全目录回归曾观察到本任务开始后由外部并发新增的 `brand_evidence_engine.test.mjs`，其对应实现当时尚未落盘；范围守卫长测期间根级统一质量审计也在合法变更受保护文件。因此该次历史结果为 142/144。随后证据引擎单项 21/21 及上述稳定回归均已通过。范围守卫仍等待根控制中心完成合法变更审查；本组织未猜测实现、未更新根保护基线。

### 当前设计态运行映射

根 `control-center/registries/organization-runtime.json` 当前已为 AI品牌官三个 Skill 绑定以下真实 `workflowPath`，且三者均为 `availability = available`：

- `organizations/ai-brand-officer/workflows/BRAND_POSITIONING_PILOT.md`
- `organizations/ai-brand-officer/workflows/BRAND_VISUAL_PILOT.md`
- `organizations/ai-brand-officer/workflows/BRAND_COMMUNICATION_PILOT.md`

这只表示根设计态运行映射可定位组织候选能力，不改变根权威 `designing`、`acceptsFormalTasks = false`，也不代表正式接单或同级组织生产连接完成。

## 7. 2026-07-30 三个核心 Skill v2 回归记录

- 原三个 Skill 与集成回归：20/20 通过、0 失败；
- 全部 AI品牌官 Node 测试首次运行：372/372 通过、0 失败；
- 完成最终文档修订后的全量复跑：370/372 通过，恢复锁子测试 “a live recovery guard is never reclaimed” 在全套并行环境中失败，并使其父级组合测试一并计为失败；同一子测试立即隔离复跑为 1/1，通过，完整 `brand_skill_runtime.test.mjs` 随后为 56/56，通过。该现象只在全套并行复跑中出现，本组织文档任务未修改运行时代码；
- 后续严格 TDD 定位确认根因：恢复守卫在 `lstat` 成功后、`realpath` 执行前被合法持有者正常释放，`realpath` 因此返回 `ENOENT`；旧实现把这类“路径已经正常消失”误判为恢复守卫异常，而不是“无需再回收”；
- 确定性 RED：新增 “a recovery guard released between lstat and realpath is already recovered” 回归，固定在 `realpath` 前释放守卫并复现失败；
- 单点修复：只在恢复守卫回收路径捕获 `realpath` 的 `ENOENT`，将其判定为守卫已经合法释放；其他错误与符号链接防护继续保持原拒绝行为；
- 修复验证：目标父组 5/5，通过；完整 `brand_skill_runtime.test.mjs` 57/57，通过；独立代理 fresh 全量回归 373/373，通过。此前 370/372 保留为问题发现证据，恢复守卫并发问题现已关闭；
- 组织边界守卫：退出码 0，`PASS: protected root paths unchanged.`；
- 根项目完整性自检：退出码 0，`Files=120`、`Directories=11`、`Issues=0`；
- 状态复核：本地 `rootControllerRegistration = registered_designing`，三个 Skill 均为组织侧 `pilot`；根权威 `status = designing`、`acceptsFormalTasks = false`；Skill 目录且仅有品牌定位、品牌视觉、品牌传播三个。

完整命令与限制记录在 `temp/skill-evals/core-skills-v2-verification.md`。恢复守卫并发问题已通过确定性回归关闭，当前自动化全量验证为 373/373；但真实企业项目、帝王现场审美通过/否决和真实跨组织回传仍未执行，不能据此宣称正式运营或真实业务验收完成。
