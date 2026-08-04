# 品牌视觉能力地图

## 模块清单

本 Skill 恰好包含以下五个内部专业模块。它们不是新的组织 Skill；根级普通宣传海报和淘宝电商套图也不计入这五个模块。

| 中文模块 | moduleId | 触发条件 | 必需输入 | 自动读取 | 输出 | 禁止 |
| --- | --- | --- | --- | --- | --- | --- |
| 品牌视觉体系 | `visual-identity-system` | 从零建体系、老品牌升级、识别混乱、需要长期延展 | 精确版本定位、名称状态、现有资产、用途与授权 | 项目资产、定位包、历史视觉与审美档案 | Logo/字标、色彩、字体、图形、图像、版式与使用规则候选 | 绕过定位定稿；AI 图冒充正式 Logo；公开相似性预查冒充商标结论 |
| 门店形象 | `store-identity` | 门头、导视、展示与空间识别需要统一 | 视觉体系、现场照片、尺寸、物业与用途 | 品牌资产、门店资料与限制 | 门头、导视、展示、材质、灯光和应用概念 | 概念图不是施工图；不得冒充结构、消防、电气、造价或建成现场 |
| 海报设计 | `poster-art-direction` | 品牌主视觉、活动或发布海报需要品牌方向 | 定位、视觉体系、核心信息、渠道、参考与禁用方向 | 项目视觉资产、参考视觉、审美档案 | 品牌策略简报、视觉 DNA、方向预选与最终品牌总审 | 在组织内复制海报制作链路；跳过根级公共流程；用执行者自评代替最终否决 |
| 产品包装 | `product-packaging` | 包装体系、SKU 延展、标签或印刷应用 | 定位、视觉体系、产品、结构、标签、法规与工艺资料 | 企业产品资料、刀模、已确认法规字段与供应链限制 | 包装结构适配、标签层级、法规字段区和印刷边界候选 | 无依据补造配方、功效、认证、标准、警示、条码或其他法规字段 |
| AI视觉生成 | `ai-visual-generation` | 需要 AI 进行视觉主体、场景或方向探索 | 人物/产品原图、身份指纹、素材授权、用途与生图通道授权 | 公共生图通道标准、产品原貌标准、当前版本绑定 | 视觉主体、场景、背景与可追溯生成记录 | 未核人物、产品、素材授权和生图通道就生成；让 AI 承担精确文字 |

## 模块依赖

1. 五个模块都必须先读取当前任务适用的定位成果；Logo、VI、门店和包装等长期资产必须绑定精确 `artifactId@version` 与 `sha256`。
2. `store-identity`、`poster-art-direction`、`product-packaging` 默认读取已确认的 `visual-identity-system` 成果；上游不适用或缺失时把必要上游模块加入计划。
3. `ai-visual-generation` 是生产方法模块，不替代视觉策略、海报制作公共流程或产品真实性审核。
4. 只运行目标需要的模块；其余模块标记“本次未调用”，不得生成空壳成果。
5. `visual-identity-system`、`store-identity`、`product-packaging` 属于长期视觉模块，执行前必须绑定来自 `ai-brand-officer` 且 `artifactId` 为 `brand-positioning-*` 语义的精确定位成果；只有临时海报与 AI 探索不机械要求。

## 公共能力边界

- 每次交接先只读根级唯一事实源 `public-skills/registry.json`，按 `publicSkillId` 或 `capabilityId` 解析实时 `maturity` 与 `allowedOrganizations`，并记录登记表路径、版本或文件 SHA-256、读取时点。组织文档不保存登记表内容的副本，也不写死某次成熟度。
- 海报模块绑定 `public.promotional-poster` / `promotional-poster`，只输出品牌策略简报和视觉 DNA；动态决策允许执行后才调用根级 `skills/creating-promotional-posters/SKILL.md` 制作。公共候选返回后，AI品牌官仍拥有品牌一致性总审和最终否决权。
- 淘宝套图绑定 `public.taobao-ecommerce-image-set` / `taobao-ecommerce`；动态决策允许执行后才引用根级 `workflows/TAOBAO_ECOMMERCE_IMAGE_SET_PILOT.md`。
- 只有 `maturity === operational`、`allowedOrganizations` 包含 `ai-brand-officer` 且总控已授权本次任务时才可进入正式执行；`maturity !== operational` 时不得宣称或执行正式任务。登记值变化后，下次读取自动采用新决策。
- 公共能力不计入品牌官三个核心 Skill，也不复制到组织目录。
- 所有品牌视觉候选在 Task4 前经过 `brand_visual_semantic_validator.mjs`；候选自报成熟度、授权、项目身份或审美档案合法性不作为可信依据。

## 共同真实性边界

- 使用人物、产品或外部素材前，分别核对身份/原貌、权利与用途；素材使用授权不等于生图工具授权。
- 复杂中文、Logo、型号、价格、日期、参数、二维码和法规字段均采用确定性排版。
- 证据不足时输出概念、占位或待验证项，不补造真实产品、现场、法规、施工或授权结论。
