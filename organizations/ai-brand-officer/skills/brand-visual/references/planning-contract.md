# 品牌视觉任务规划契约

## 规划目标

规划器只选择完成当前目标所需的视觉模块，并记录选择理由、依赖、版本、授权、验收与停止条件。首次建立视觉体系或审美不确定时先形成三个真正不同的方向；不得把换色、换名称当成三个方向。

## 输入与读取顺序

1. 读取总控下发的 `taskIdentity` 与当前企业项目舱；
2. 读取品牌定位、品牌资产和其他上游精确 `artifactId@version`、`sha256`；禁止引用 `current`、`latest` 或模糊“最新版”；
3. 执行飞书知识库前置检索；
4. 吸收当前对话新增的企业事实和帝王明确审美反馈；
5. 使用互联网公开来源核验竞品、相似性、公开事实和生产边界。

飞书为 `no_hit` 或 `degraded` 时保存真实状态，告知覆盖限制并继续可安全推进的工作，不把无命中解释为事实不存在。

## 动态路由

| 任务信号 | 选择模块 |
| --- | --- |
| 从零建视觉体系、整体 VI 升级 | `visual-identity-system` |
| 门头、门店导视、展示空间 | `store-identity`；没有固定视觉体系时补 `visual-identity-system` |
| 普通品牌、活动或发布海报 | `poster-art-direction`；需要 AI 主体时补 `ai-visual-generation` |
| 包装、标签、SKU 延展 | `product-packaging`；没有固定视觉体系时补 `visual-identity-system` |
| AI 场景、人物、产品或氛围探索 | `ai-visual-generation`，并保留任务所属的策略模块 |

计划必须分别列出 `selectedModuleIds` 与 `unselectedModuleIds`。未选模块写“本次未调用”，不得机械启动五模块。

`visual-identity-system`、`store-identity` 或 `product-packaging` 任一被选择时，规划器必须找到来自 `ai-brand-officer`、`artifactId` 语义为 `brand-positioning-*`、版本为正整数且带 SHA-256 的精确品牌定位上游；Logo/VI、门店长期形象和包装定稿不得在缺定位时进入执行。只有 `poster-art-direction`、`ai-visual-generation` 的单张临时海报或 AI 探索不机械要求该上游。运行时在 Task4 前再次复验。

## 三方向与参考视觉

- 每个可进入审核的视觉候选必须恰好给出三个方向，每个方向绑定一个 `assetRef` 或 `imageSha256`，三个资产哈希必须唯一。
- `pairwiseDifferenceEvidence` 必须覆盖 01/02、01/03、02/03 三对；每对至少在构图、裁切、光线、色彩、字体、材质、留白、信息密度、图形语言或图像语言中的两个枚举维度存在实质差别。只改名称、解释或文案不构成不同方向。
- 有参考图时先提炼视觉 DNA：构图、裁切、光线、色彩、字体、材质、留白、信息密度和反面模式；提炼原则，不复制人物、品牌、水印或原版排版。
- 帝王明确授权执政官做主时可内部预选，但必须保留三方向及选择依据，不把审批变成中途技术选择题。

## 公共能力动态调用

AI品牌官负责品牌策略简报与视觉 DNA，并在公共候选返回后执行最终质量否决。

1. 每次调用前读取根级唯一事实源 `public-skills/registry.json`，按 `publicSkillId` 或 `capabilityId` 查找条目；记录登记表路径、文件 SHA-256、读取时点，以及登记表版本（存在时）或 `sha256:<digest>` 形式的 `versionOrHash`。
2. 读取当前条目的 `maturity` 与 `allowedOrganizations`。只有 `maturity === operational`、`allowedOrganizations` 包含 `ai-brand-officer` 且总控授权本次任务时，计划才可标记为“允许正式调用”；若 `maturity !== operational` 或组织不在许可名单，计划必须标记“禁止正式调用”并返回总控，不得沿用历史快照。
3. `poster-art-direction` 绑定 `public.promotional-poster` / `promotional-poster`，先形成品牌策略简报、视觉 DNA、核心信息层级、方向与禁用项；允许调用后才进入根级 `skills/creating-promotional-posters/SKILL.md` 的任务清单和门禁。
4. 淘宝套图绑定 `public.taobao-ecommerce-image-set` / `taobao-ecommerce`；允许调用后才转交根级 `workflows/TAOBAO_ECOMMERCE_IMAGE_SET_PILOT.md`。
5. 公共 Skill 只负责公共制作与技术验收，不计入品牌官三个核心 Skill；公共候选返回后由品牌官复核定位、视觉 DNA、品牌资产、产品原貌、精确文字、系列一致和渠道场景。
6. 品牌官拥有最终质量否决；命中硬否决或海报低于 80 分不得提交帝王候选。

## 人物、产品与生图前置

- AI视觉先核人物身份与授权、产品原图与身份指纹、素材来源与用途、生图通道和当前任务/版本授权。
- 执行 `shared/IMAGE_GENERATION_CHANNEL_STANDARD.md` 与 `shared/PRODUCT_ASSET_FIDELITY_STANDARD.md`；产品可见视角不足时请求补图或采用中性示意。
- 真人、产品、场景或展示方式被实质改变时原确认失效，必须重新确认。
- AI 只承担适合生成的视觉主体与背景；复杂中文、Logo、型号、价格、参数、日期、二维码和法规字段使用确定性排版。

## 包装与门店生产边界

- 门店计划区分概念、深化与生产输入；缺现场、实测、物业、消防、电气或施工资料时只产出概念图，不冒充施工图。
- 包装计划区分视觉母版、结构适配、标签法规和印刷工艺；结构、标签、法规字段或印刷依据缺失时保留占位，不补造。

## 质量、调试与完成条件

计划必须包含：

- 定位与上游精确版本；
- 选择/未选择模块和依赖；
- 素材、版权、产品原貌、人物和通道授权；
- 参考视觉 DNA 与三方向触发判断；
- 规则审核、视觉专业审核和品牌一致性总审；
- 海报硬否决、100 分量表、80 分提交门槛；
- 相同视觉根因最多三轮的局部修正、模块重做和方法或路径切换；
- 双层成果返回总控，不写 `shared-artifacts/`、`outputs/`，不对外发布。
