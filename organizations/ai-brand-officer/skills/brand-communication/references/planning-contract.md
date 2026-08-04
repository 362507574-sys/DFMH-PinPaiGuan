# 品牌传播规划契约

## 上游固定与自动读取

1. 所有传播任务自动读取当前企业项目舱中已确认的品牌定位精确版本；内容传播或品牌活动还必须读取品牌视觉精确版本。记录 `artifactId@version`、`sha256`、`sourceOrganizationId=ai-brand-officer`。
2. 已确认资料不得重复向需求者索要；需求者只补充本次新增变化和不可替代事实。
3. 禁止引用 `current`、`latest`、“最新定位”或“当前视觉”等模糊版本。
4. 上游发布新版本不会静默替换本任务已经固定的版本。
5. 缺少定位精确版本时，任何传播任务都不得定稿；内容传播或品牌活动缺少视觉精确版本时也不得定稿。
6. 局部品牌故事或纯创始人IP任务在已有定位、视觉客观不适用时可继续候选，必须把 `visualBindings` 标为 `not-applicable` / `pending` 并记录理由；不得伪造视觉引用。
7. 当前过渡期只接受定位成果 ID：`brand-positioning`、`brand-positioning-v2`、`brand-positioning-core`；视觉成果 ID：`brand-visual`、`brand-visual-v2`、`brand-visual-system`。任意后缀、`-fake` 或近似名称均拒绝。
8. 长期方案应由总控项目上下文提供受信的 `producerSkillId`、`artifactType` 及元数据哈希，并由生产 Skill 身份校验替代本地白名单；本次不修改根级合同。

## 资料顺序

固定使用：当前项目舱与上游固定成果 → 飞书知识库 → 对话补充 → 互联网公开来源。

`no_hit` / `degraded` 时保存真实凭证、告知限制、继续可安全工作，不伪造飞书命中。事实、专业判断、推断、假设、未知和禁止公开信息必须分开。

## 按需路由

| 目标信号 | 选择模块 | 不执行 |
| --- | --- | --- |
| 信息体系、品牌表达、内容母题、企业介绍 | `content-communication` | 其他未命中模块 |
| 发布、周年、联名、品牌事件 | `brand-campaign` | 日常渠道运营 |
| 品牌起源、使命、品牌故事 | `brand-story` | 无证据人物包装 |
| 创始人IP、创始人表达、创始人故事 | `founder-ip-communication` | 日更脚本矩阵 |
| 多类品牌传播目标 | 全部命中模块的规范顺序并集 | 未命中模块 |
| 纯小红书种草、短视频日更、公众号日常、私域运营、投流获客 | 不创建传播计划；返回 `ownership_mismatch → ai-growth-strategist` | 不做渠道成稿、排期、预算、投流与运营 |
| 纯销售沟通、成交话术、成交脚本、成交策略 | 不创建传播计划；返回 `ownership_mismatch → ai-deal-officer` | 不做成交执行 |
| 品牌信息母体/内容母题 + 日常渠道请求 | 只选 `content-communication` 的品牌部分，并记录 `ownership handoff: ai-growth-strategist` | 不执行渠道工作 |
| 品牌信息母体/内容母题 + 日常渠道 + 成交请求 | 只选命中的品牌模块，同时按固定顺序记录 `ai-growth-strategist`、`ai-deal-officer` 两个 handoff | 不执行增长或成交工作 |

单项任务只选择必要模块，不机械全开。无法安全命中时才使用完整 Skill 回退，并在 `routingReason` 说明。

显式模块不能覆盖目标语义：目标明确命中的全部传播模块都是必需依赖，`requestedModuleIds` 少报任一模块都必须拒绝并列出缺失模块，不得自动降级、不得借少报内容/活动模块绕开品牌视觉依赖。

增长归属先按标点和转折词拆成语义片段，再按“渠道集合 × 运营动作集合”组合判定，不依赖固定整句。只有渠道词与动作词同时位于同一个肯定片段才命中；渠道包括小红书、抖音、视频号、公众号、社群、私域、直播、信息流、账号等，动作包括日更、运营、种草、投放、获客、引流、排期、矩阵、广告等。否定词统一覆盖“不、未、不要、无需、不需要、不做、不运营、不考虑、暂不、不再、停止、取消、避免、排除”；被否定片段不产生增长交接，混合句只计算肯定片段。只有“品牌”模糊词不算传播模块信号。

## 统一规划链路

总控任务身份 → 固定定位与视觉 → 证据分类 → 按需模块 → 唯一核心信息 → 规则审核 → 独立传播专业审核 → 同因最多三轮定向返工 → 双层候选包 → 返回总控。

规划必须写明：

- `taskIdentity` 与 `skillId=brand-communication`；
- `selectedModuleIds`、`skippedModuleIds` 和路由原因；
- `upstreamArtifacts` 的精确版本和 SHA-256；
- 必需证据、验收标准、停止条件；
- 增长与成交边界；
- 当前任务不直接发布、不写 `shared-artifacts/` 或 `outputs/`。

## 事实与定稿门禁

- 品牌故事采用“真实起源 → 冲突 → 选择 → 价值 → 证据”，缺一项可降级为待验证候选，不补造。
- 创始人IP只有身份、履历、观点、公开授权和品牌关系均可验证时才能定稿。
- 一个传播项目只保留一个核心信息，其余降为支持信息。
- 承诺与案例逐条绑定 `proofLibrary`；无法证实的表达进入 `forbiddenClaims` 或未知。
- 核心信息、支持信息、信任理由、内容母题、`proofLibrary`、故事分项、创始人分项和活动事实中的每个主张都必须包含安全 `claimKey`、`claimDigest`、`evidenceIds`、`status`。
- 每个 `evidenceId` 必须命中本次 `evidenceBundle.entries`；确认级表达还要求证据条目的 `claimKey` 完全相同，类别属于 `upstream-artifact`、`feishu`、`conversation` 或 `public-web`，置信等级为 `supported` / `confirmed`。确认级 `claimDigest` 必须存在；校验器对候选实际主张文本和每条真实 `evidence.claim` 分别执行 NFKC、首尾去空白与连续空白折叠后重算 SHA-256，并要求候选重算值、候选填写值及全部证据重算值完全相同。候选自报摘要不能替代候选实际文本；不同文案借用正确证据摘要、多条证据混入不同事实或同一 `claimKey` 下出现不同事实均不得确认。缺少 `claimKey` 的证据不能确认，同一证据不得跨不同 `claimKey` 复用。
- 定位或视觉冲突、要求虚构、组织越权或会改变品牌方向时停止晋级。

## Task4 前语义门禁

执行结果先通过 `brand_communication_semantic_validator.mjs`，再进入规则审核与专业审核。正文只允许 `brand-communication-candidate.schema.json` 定义的十个业务字段；缺字段、多字段、越权渠道边界、伪造视觉引用、未知证据引用或无证据却标记 `confirmed`，均在 Task4 前阻断，审核次数保持为零。

语义政策由固定 `policyVersion`、校验器源码 SHA-256 和候选 Schema SHA-256 联合生成 `policyContextHash`，写入任务内不可变 `communication-policy-context.json`，并绑定租约、操作日志、候选侧车、审核记录和交付包。恢复阶段若文件缺失、字节不规范、哈希被替换或当前源码/Schema 已变化，必须在任务边界内写入规范、不可变的迁移审计，返回 `policy_migration_required`；旧候选和旧审核均不得复用。

## 分工

AI品牌官提供品牌信息母体、内容母题、原则、证据和禁区，并承担发布、周年、联名、事件等重大品牌传播。

AI增长战略官负责小红书、短视频、公众号、私域的选题、节奏、运营与获客；品牌官不做小红书种草成稿、短视频日更、公众号日常、私域运营或投流获客。

AI成交官负责销售沟通、成交话术、成交脚本和成交策略；品牌官只传递事实锁、核心信息、语气与禁语。
