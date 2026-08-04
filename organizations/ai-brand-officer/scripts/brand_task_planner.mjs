import {
  BRAND_SKILL_MODULES,
  assertPlain,
  rejectUnknown,
  safeId,
  stableSha256,
  stableStringify,
  validateTaskIdentity,
} from './brand_contracts.mjs';

const REQUEST_FIELDS = Object.freeze([
  'taskId',
  'enterpriseId',
  'businessProjectId',
  'skillId',
  'goal',
  'requestedModuleIds',
  'availableInputs',
  'upstreamArtifacts',
  'constraints',
]);

const PLAN_FIELDS = Object.freeze([
  'schemaVersion',
  'taskId',
  'enterpriseId',
  'businessProjectId',
  'skillId',
  'goal',
  'selectedModuleIds',
  'skippedModuleIds',
  'steps',
  'requiredEvidence',
  'upstreamArtifacts',
  'acceptanceCriteria',
  'stopConditions',
  'initialState',
  'routingReason',
  'planHash',
]);

const SHA256 = /^[a-f0-9]{64}$/u;
const ASCII_KEYWORD = /^[a-z0-9]+$/u;
const MAX_GOAL_CODE_POINTS = 6000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_PROPERTIES = 100;
const MAX_UPSTREAM_ARTIFACTS = 100;
const LONG_TERM_VISUAL_MODULES = new Set([
  'visual-identity-system',
  'store-identity',
  'product-packaging',
]);
const BRAND_POSITIONING_ARTIFACT_IDS = new Set([
  'brand-positioning',
  'brand-positioning-v2',
  'brand-positioning-core',
]);
const BRAND_VISUAL_ARTIFACT_IDS = new Set([
  'brand-visual',
  'brand-visual-v2',
  'brand-visual-system',
]);
const EVIDENCE_CATEGORIES = new Set([
  'upstream-artifact',
  'feishu',
  'conversation',
  'public-web',
  'professional-judgment',
  'inference',
  'assumption',
  'unknown',
]);
const ROUTING_REASONS = new Set([
  'explicit-modules',
  'goal-keyword-match',
  'full-skill-fallback',
]);
const GROWTH_CHANNEL_TERMS = Object.freeze([
  '小红书',
  '抖音',
  '视频号',
  '短视频',
  '公众号',
  '社群',
  '私域',
  '直播',
  '信息流',
  '账号',
  '渠道',
  '平台',
]);
const GROWTH_OPERATION_TERMS = Object.freeze([
  '日更',
  '运营',
  '种草',
  '投放',
  '投流',
  '获客',
  '引流',
  '排期',
  '矩阵',
  '广告',
  '选题',
  '节奏',
  '培育',
]);
const DEAL_OWNERSHIP_TERMS = Object.freeze([
  '销售沟通',
  '销售脚本',
  '成交话术',
  '成交脚本',
  '成交策略',
]);

const ROUTING_KEYWORDS = Object.freeze({
  'brand-positioning': Object.freeze({
    'category-positioning': Object.freeze([
      '品类',
      '赛道',
      '客户怎么理解',
      '替代方案',
    ]),
    'audience-positioning': Object.freeze([
      '用户',
      '客户',
      '人群',
      '决策者',
      '使用者',
    ]),
    'differentiation-positioning': Object.freeze([
      '差异',
      '竞争',
      '独特价值',
      '为什么选',
    ]),
    'mindshare-occupation': Object.freeze([
      '心智',
      '记住',
      '关键词',
      '认知位置',
    ]),
  }),
  'brand-visual': Object.freeze({
    'visual-identity-system': Object.freeze([
      'logo',
      'vi',
      '视觉体系',
      '字体',
      '色彩',
    ]),
    'store-identity': Object.freeze([
      '门店',
      '门头',
      '导视',
      '空间形象',
    ]),
    'poster-art-direction': Object.freeze([
      '海报',
      '主视觉',
      '活动视觉',
    ]),
    'product-packaging': Object.freeze([
      '包装',
      '瓶身',
      '盒型',
      '标签',
    ]),
    'ai-visual-generation': Object.freeze([
      '生图',
      'ai视觉',
      '生成图',
      '图像生成',
    ]),
  }),
  'brand-communication': Object.freeze({
    'content-communication': Object.freeze([
      '内容母题',
      '品牌表达',
      '品牌信息母体',
      '信息体系',
      '企业介绍',
    ]),
    'brand-campaign': Object.freeze([
      '品牌活动',
      '发布会',
      '周年',
      '联名',
      '战役',
    ]),
    'brand-story': Object.freeze([
      '品牌故事',
      '品牌起源',
      '使命',
      '愿景',
    ]),
    'founder-ip-communication': Object.freeze([
      '创始人ip',
      '创始人表达',
      '创始人故事',
    ]),
  }),
});

const POSITIONING_SUPPORTING_ROUTES = Object.freeze([
  Object.freeze({
    id: 'whole-repositioning',
    triggers: Object.freeze([
      '整体重定位',
      '整体品牌升级',
      '老品牌整体升级',
    ]),
    evidence:
      '旧定位、客户与竞争认知、能力证据和现有品牌资产必须完整绑定。',
    acceptance:
      '新旧定位取舍、四模块结论与品牌迁移约束全部清晰。',
    stop:
      '缺少会改变整体品牌方向的事实时停止晋级。',
    moduleIds: Object.freeze([
      'category-positioning',
      'audience-positioning',
      'differentiation-positioning',
      'mindshare-occupation',
    ]),
  }),
  Object.freeze({
    id: 'product-extension',
    triggers: Object.freeze([
      '新品延伸',
      '推出新品',
      '新产品延伸',
    ]),
    evidence:
      '母品牌定位、新品能力、目标人群、用户需求和品牌延伸依据必须可追溯。',
    acceptance:
      '新品品类、用户、差异化与母品牌关系均成立。',
    stop:
      '新品能力或品牌延伸依据缺失时只能形成待验证候选。',
    moduleIds: Object.freeze([
      'category-positioning',
      'audience-positioning',
      'differentiation-positioning',
    ]),
    optionalMindshareTriggers: Object.freeze([
      '改变主心智',
      '调整主心智',
      '主心智变化',
      '重塑主心智',
    ]),
  }),
  Object.freeze({
    id: 'brand-architecture',
    triggers: Object.freeze([
      '母子品牌',
      '品牌架构',
    ]),
    evidence:
      '现有品牌层级、产品关系、客户认知及共享和隔离资产必须可追溯。',
    acceptance:
      '每层品牌角色、差异、主要心智与资产边界清晰。',
    stop:
      '产品线或企业品牌事实缺失时只能形成待验证架构候选。',
    moduleIds: Object.freeze([
      'category-positioning',
      'differentiation-positioning',
      'mindshare-occupation',
    ]),
    optionalAudienceTriggers: Object.freeze([
      '目标人群变化',
      '目标用户变化',
      '受众变化',
      '用户变化',
    ]),
  }),
  Object.freeze({
    id: 'brand-name',
    triggers: Object.freeze([
      '名称候选',
      '品牌名称',
      '品牌命名',
    ]),
    evidence:
      '已确认品类、主要心智、读音语义、记忆性及公开名称冲突必须记录。',
    acceptance:
      '名称候选承接品类和主要心智，并明确公开预查风险。',
    stop:
      '公开搜索不得被解释为商标可注册或不可注册结论。',
    moduleIds: Object.freeze([
      'category-positioning',
      'mindshare-occupation',
    ]),
  }),
  Object.freeze({
    id: 'slogan',
    triggers: Object.freeze([
      '品牌口号',
      '口号',
    ]),
    evidence:
      '一个主要心智、可信价值主张、用户复述和禁用表达必须可追溯。',
    acceptance:
      '口号强化唯一主要心智且没有制造新的无证据承诺。',
    stop:
      '存在多心智或证据不足时不得定稿口号。',
    moduleIds: Object.freeze([
      'mindshare-occupation',
    ]),
  }),
]);

const MODULE_ACCEPTANCE = Object.freeze({
  'category-positioning': '品类与赛道边界清晰，并说明客户替代方案。',
  'audience-positioning': '目标用户、决策者与使用者范围清晰且有证据。',
  'differentiation-positioning': '差异化价值与选择理由可被证据支持。',
  'mindshare-occupation': '心智关键词与认知位置具体、可记忆且不越界。',
  'visual-identity-system': 'Logo、字体、色彩与视觉体系承接已确认定位。',
  'store-identity': '门店、门头、导视与空间形象边界清晰且可落地。',
  'poster-art-direction': '海报主视觉与活动视觉遵守品牌一致性规则。',
  'product-packaging': '包装、瓶身、盒型与标签事实和生产边界可核对。',
  'ai-visual-generation': 'AI视觉生成遵守通道授权与产品原貌一致性规则。',
  'content-communication': '内容母题、品牌表达与信息层级一致且有事实依据。',
  'brand-campaign': '品牌活动具有唯一主题、阶段节奏与组织边界。',
  'brand-story': '品牌故事、起源、使命与愿景均绑定真实证据。',
  'founder-ip-communication': '创始人IP表达基于真实经历并明确可说与不可说边界。',
});

const SKILL_LABELS = Object.freeze({
  'brand-positioning': '品牌定位',
  'brand-visual': '品牌视觉',
  'brand-communication': '品牌传播',
});

export function buildBrandTaskPlan(input) {
  assertPlain(input, 'brand task plan request');
  rejectUnknown(input, REQUEST_FIELDS, 'brand task plan request');

  const identity = validateTaskIdentity({
    enterpriseId: input.enterpriseId,
    businessProjectId: input.businessProjectId,
    taskId: input.taskId,
  });
  const skillId = validateSkillId(input.skillId);
  const goal = validateGoal(input.goal);
  const requestedModuleIds = validateRequestedModules(
    input.requestedModuleIds === undefined ? [] : input.requestedModuleIds,
    skillId,
  );
  const availableInputs = normalizeJsonInput(
    input.availableInputs === undefined ? {} : input.availableInputs,
    'availableInputs',
  );
  const constraints = normalizeJsonInput(
    input.constraints === undefined ? {} : input.constraints,
    'constraints',
  );
  const upstreamArtifacts = validateUpstreamArtifacts(
    input.upstreamArtifacts === undefined ? [] : input.upstreamArtifacts,
  );
  const ownership = analyzeCommunicationOwnership({ skillId, goal });
  rejectPureCommunicationOwnershipMismatch({ skillId, ownership });

  const {
    selectedModuleIds,
    routingReason,
    supportingRoutes,
  } = selectModules({
    skillId,
    goal,
    requestedModuleIds,
  });
  const selected = new Set(selectedModuleIds);
  const skippedModuleIds = BRAND_SKILL_MODULES[skillId].filter(
    (moduleId) => !selected.has(moduleId),
  );
  assertVisualPositioningPrerequisite({
    skillId,
    selectedModuleIds,
    upstreamArtifacts,
  });
  const communicationUpstream = assertCommunicationUpstreamPrerequisite({
    skillId,
    selectedModuleIds,
    upstreamArtifacts,
  });

  const steps = [
    'knowledge-preflight',
    'bind-upstream-artifacts',
    'collect-evidence',
    ...selectedModuleIds.map((moduleId) => `execute:${moduleId}`),
    'rule-review',
    'professional-review',
    'debug-or-package',
  ];
  const requiredEvidence = buildRequiredEvidence({
    skillId,
    selectedModuleIds,
    availableInputs,
    constraints,
    supportingRoutes,
  });
  const acceptanceCriteria = buildAcceptanceCriteria(
    skillId,
    selectedModuleIds,
    supportingRoutes,
    ownership.handoffOrganizationIds,
    communicationUpstream,
  );
  const stopConditions = buildStopConditions(supportingRoutes);

  const planWithoutHash = {
    schemaVersion: 1,
    taskId: identity.taskId,
    enterpriseId: identity.enterpriseId,
    businessProjectId: identity.businessProjectId,
    skillId,
    goal,
    selectedModuleIds,
    skippedModuleIds,
    steps,
    requiredEvidence,
    upstreamArtifacts,
    acceptanceCriteria,
    stopConditions,
    initialState: 'planning',
    routingReason,
  };
  const plan = {
    ...planWithoutHash,
    planHash: stableSha256(planWithoutHash),
  };
  validateBrandTaskPlan(plan);
  return deepFreeze(plan);
}

export function validateBrandTaskPlan(plan) {
  assertPlain(plan, 'brand task plan');
  rejectUnknown(plan, PLAN_FIELDS, 'brand task plan');
  for (const field of PLAN_FIELDS) {
    if (!Object.hasOwn(plan, field)) {
      throw new Error(`brand task plan is missing field: ${field}`);
    }
  }
  if (plan.schemaVersion !== 1) {
    throw new Error('brand task plan schemaVersion must be 1');
  }
  validateTaskIdentity({
    enterpriseId: plan.enterpriseId,
    businessProjectId: plan.businessProjectId,
    taskId: plan.taskId,
  });
  const skillId = validateSkillId(plan.skillId);
  const normalizedGoal = validateGoal(plan.goal);
  if (normalizedGoal !== plan.goal) {
    throw new Error('brand task plan goal must be normalized');
  }

  const selectedModuleIds = validatePlanModuleIds(
    plan.selectedModuleIds,
    skillId,
    'selectedModuleIds',
    { requireNonEmpty: true },
  );
  const skippedModuleIds = validatePlanModuleIds(
    plan.skippedModuleIds,
    skillId,
    'skippedModuleIds',
  );
  const selected = new Set(selectedModuleIds);
  if (skippedModuleIds.some((moduleId) => selected.has(moduleId))) {
    throw new Error('selected and skipped modules overlap');
  }
  const partition = new Set([...selectedModuleIds, ...skippedModuleIds]);
  if (
    partition.size !== BRAND_SKILL_MODULES[skillId].length
    || BRAND_SKILL_MODULES[skillId].some((moduleId) => !partition.has(moduleId))
  ) {
    throw new Error('selected and skipped modules must form a complete skill partition');
  }

  if (!Array.isArray(plan.steps) || plan.steps.some((step) => typeof step !== 'string')) {
    throw new TypeError('brand task plan steps must be an array of strings');
  }
  const executeModuleIds = plan.steps
    .filter((step) => step.startsWith('execute:'))
    .map((step) => step.slice('execute:'.length));
  if (!sameArray(executeModuleIds, selectedModuleIds)) {
    throw new Error('selected modules and execute steps must correspond in order');
  }
  const expectedSteps = [
    'knowledge-preflight',
    'bind-upstream-artifacts',
    'collect-evidence',
    ...selectedModuleIds.map((moduleId) => `execute:${moduleId}`),
    'rule-review',
    'professional-review',
    'debug-or-package',
  ];
  if (!sameArray(plan.steps, expectedSteps)) {
    throw new Error('brand task plan steps are out of order');
  }

  validateEvidenceRequirements(plan.requiredEvidence);
  const normalizedUpstreamArtifacts = validateUpstreamArtifacts(
    plan.upstreamArtifacts,
  );
  assertVisualPositioningPrerequisite({
    skillId,
    selectedModuleIds,
    upstreamArtifacts: normalizedUpstreamArtifacts,
  });
  const communicationUpstream = assertCommunicationUpstreamPrerequisite({
    skillId,
    selectedModuleIds,
    upstreamArtifacts: normalizedUpstreamArtifacts,
  });
  validateNonEmptyStringList(
    plan.acceptanceCriteria,
    'acceptanceCriteria',
    { minimum: 5, maximum: 9 },
  );
  const ownership = analyzeCommunicationOwnership({
    skillId,
    goal: plan.goal,
  });
  rejectPureCommunicationOwnershipMismatch({ skillId, ownership });
  for (const organizationId of ownership.handoffOrganizationIds) {
    if (!plan.acceptanceCriteria.includes(
      communicationOwnershipHandoffCriterion(organizationId),
    )) {
      throw new Error(
        `acceptanceCriteria is missing ownership handoff: ${organizationId}`,
      );
    }
  }
  if (
    communicationUpstream.visualStatus !== null
    && !plan.acceptanceCriteria.includes(
      communicationVisualAcceptanceCriterion(
        communicationUpstream.visualStatus,
      ),
    )
  ) {
    throw new Error(
      'acceptanceCriteria is missing the brand-visual not-applicable or bound rule',
    );
  }
  validateNonEmptyStringList(
    plan.stopConditions,
    'stopConditions',
    { minimum: 5, maximum: 5 },
  );
  if (plan.initialState !== 'planning') {
    throw new Error('brand task plan initialState must be planning');
  }
  if (!ROUTING_REASONS.has(plan.routingReason)) {
    throw new Error('brand task plan routingReason is invalid');
  }
  const canonicalRoutingReason = classifyBrandRoutingReason({
    skillId,
    goal: plan.goal,
    selectedModuleIds,
  });
  if (plan.routingReason !== canonicalRoutingReason) {
    throw new Error('brand task plan routingReason does not match canonical routing');
  }
  if (typeof plan.planHash !== 'string' || !SHA256.test(plan.planHash)) {
    throw new Error('brand task plan planHash must be a lowercase SHA-256');
  }
  const { planHash, ...planWithoutHash } = plan;
  if (planHash !== stableSha256(planWithoutHash)) {
    throw new Error('brand task plan planHash does not match plan contents');
  }
  return true;
}

function validateSkillId(skillId) {
  if (typeof skillId !== 'string' || !Object.hasOwn(BRAND_SKILL_MODULES, skillId)) {
    throw new Error(`unknown skillId: ${String(skillId)}`);
  }
  return skillId;
}

function validateGoal(goal) {
  if (typeof goal !== 'string') {
    throw new TypeError('goal must be a string');
  }
  const normalizedGoal = goal.trim();
  if (
    normalizedGoal.length === 0
    || Array.from(normalizedGoal).length > MAX_GOAL_CODE_POINTS
  ) {
    throw new TypeError(
      `goal must be non-empty and at most ${MAX_GOAL_CODE_POINTS} code points`,
    );
  }
  return normalizedGoal;
}

function validatePlanModuleIds(
  moduleIds,
  skillId,
  label,
  { requireNonEmpty = false } = {},
) {
  if (!Array.isArray(moduleIds)) {
    throw new TypeError(`${label} must be an array`);
  }
  if (requireNonEmpty && moduleIds.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  const permitted = new Set(BRAND_SKILL_MODULES[skillId]);
  const seen = new Set();
  for (const moduleId of moduleIds) {
    if (typeof moduleId !== 'string' || !permitted.has(moduleId)) {
      throw new Error(`${label} contains a module outside skillId ${skillId}`);
    }
    if (seen.has(moduleId)) {
      throw new Error(`${label} contains duplicate moduleId: ${moduleId}`);
    }
    seen.add(moduleId);
  }
  return moduleIds;
}

function validateRequestedModules(requestedModuleIds, skillId) {
  if (!Array.isArray(requestedModuleIds)) {
    throw new TypeError('requestedModuleIds must be an array');
  }
  const allModules = new Set(Object.values(BRAND_SKILL_MODULES).flat());
  const permittedModules = new Set(BRAND_SKILL_MODULES[skillId]);
  const uniqueModules = [];
  const seen = new Set();
  for (const moduleId of requestedModuleIds) {
    if (typeof moduleId !== 'string' || !allModules.has(moduleId)) {
      throw new Error(`unknown moduleId: ${String(moduleId)}`);
    }
    if (!permittedModules.has(moduleId)) {
      throw new Error(`moduleId ${moduleId} does not belong to skillId ${skillId}`);
    }
    if (!seen.has(moduleId)) {
      seen.add(moduleId);
      uniqueModules.push(moduleId);
    }
  }
  return uniqueModules;
}

function validateEvidenceRequirements(requiredEvidence) {
  if (
    !Array.isArray(requiredEvidence)
    || requiredEvidence.length < 5
    || requiredEvidence.length > 9
  ) {
    throw new Error('requiredEvidence must contain between 5 and 9 entries');
  }
  const requirementIds = new Set();
  for (const [index, entry] of requiredEvidence.entries()) {
    const label = `requiredEvidence at index ${index}`;
    assertPlain(entry, label);
    rejectUnknown(
      entry,
      ['requirementId', 'category', 'description', 'mandatory'],
      label,
    );
    safeId(entry.requirementId, `${label} requirementId`);
    if (requirementIds.has(entry.requirementId)) {
      throw new Error(`requiredEvidence has duplicate requirementId: ${entry.requirementId}`);
    }
    requirementIds.add(entry.requirementId);
    if (!EVIDENCE_CATEGORIES.has(entry.category)) {
      throw new Error(`${label} category is invalid`);
    }
    validateNonEmptyString(entry.description, `${label} description`);
    if (typeof entry.mandatory !== 'boolean') {
      throw new TypeError(`${label} mandatory must be boolean`);
    }
  }
}

function validateNonEmptyStringList(
  values,
  label,
  { minimum, maximum },
) {
  if (
    !Array.isArray(values)
    || values.length < minimum
    || values.length > maximum
  ) {
    throw new Error(`${label} must contain between ${minimum} and ${maximum} entries`);
  }
  const unique = new Set();
  for (const [index, value] of values.entries()) {
    validateNonEmptyString(value, `${label} at index ${index}`);
    if (unique.has(value)) throw new Error(`${label} contains duplicate entries`);
    unique.add(value);
  }
}

function validateNonEmptyString(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1000
  ) {
    throw new TypeError(`${label} must be a non-empty string of at most 1000 characters`);
  }
}

function sameArray(first, second) {
  return (
    first.length === second.length
    && first.every((value, index) => value === second[index])
  );
}

function selectModules({ skillId, goal, requestedModuleIds }) {
  const positioningResolution = skillId === 'brand-positioning'
    ? resolvePositioningGoal(goal)
    : null;
  const supportingRoutes = positioningResolution?.supportingRoutes ?? [];
  const keywordSelected = positioningResolution?.selectedModuleIds
    ?? selectKeywordModules(skillId, goal);
  if (
    skillId === 'brand-communication'
    && requestedModuleIds.length > 0
    && keywordSelected.length > 0
  ) {
    const requested = new Set(requestedModuleIds);
    const missingModuleIds = keywordSelected.filter(
      (moduleId) => !requested.has(moduleId),
    );
    if (missingModuleIds.length > 0) {
      throw new Error(
        `requestedModuleIds conflict with explicit communication goal dependencies; missing: ${missingModuleIds.join(', ')}`,
      );
    }
  }
  if (requestedModuleIds.length > 0 && supportingRoutes.length > 0) {
    const requested = new Set(requestedModuleIds);
    const requiredBySupportingSteps = new Set(
      supportingRoutes.flatMap(({ moduleIds }) => moduleIds),
    );
    const missingModuleIds = BRAND_SKILL_MODULES['brand-positioning'].filter(
      (moduleId) => (
        requiredBySupportingSteps.has(moduleId)
        && !requested.has(moduleId)
      ),
    );
    if (missingModuleIds.length > 0) {
      throw new Error(
        `requestedModuleIds conflict with supportingStep dependencies; missing: ${missingModuleIds.join(', ')}`,
      );
    }
  }
  const selectedModuleIds = requestedModuleIds.length > 0
    ? requestedModuleIds
    : keywordSelected.length > 0
      ? keywordSelected
      : [...BRAND_SKILL_MODULES[skillId]];
  return {
    selectedModuleIds,
    supportingRoutes,
    routingReason: classifyBrandRoutingReason({
      skillId,
      goal,
      selectedModuleIds,
    }),
  };
}

function validateUpstreamArtifacts(upstreamArtifacts) {
  if (!Array.isArray(upstreamArtifacts)) {
    throw new TypeError('upstreamArtifacts must be an array');
  }
  if (upstreamArtifacts.length > MAX_UPSTREAM_ARTIFACTS) {
    throw new Error(
      `upstreamArtifacts must contain at most ${MAX_UPSTREAM_ARTIFACTS} entries`,
    );
  }
  const seen = new Set();
  return upstreamArtifacts.map((artifact, index) => {
    const label = `upstream artifact at index ${index}`;
    assertPlain(artifact, label);
    rejectUnknown(
      artifact,
      ['artifactId', 'version', 'sha256', 'sourceOrganizationId'],
      label,
    );
    const normalized = {
      artifactId: safeId(artifact.artifactId, `${label} artifactId`),
      version: artifact.version,
      sha256: artifact.sha256,
      sourceOrganizationId: safeId(
        artifact.sourceOrganizationId,
        `${label} sourceOrganizationId`,
      ),
    };
    if (!Number.isSafeInteger(normalized.version) || normalized.version < 1) {
      throw new TypeError(`${label} version must be a positive safe integer`);
    }
    if (typeof normalized.sha256 !== 'string' || !SHA256.test(normalized.sha256)) {
      throw new TypeError(`${label} sha256 must be 64 lowercase hexadecimal characters`);
    }
    const referenceKey = `${normalized.artifactId}@${normalized.version}`;
    if (seen.has(referenceKey)) {
      throw new Error(`duplicate upstream artifact reference: ${referenceKey}`);
    }
    seen.add(referenceKey);
    return normalized;
  });
}

export function assertVisualPositioningPrerequisite({
  skillId,
  selectedModuleIds,
  upstreamArtifacts,
}) {
  if (skillId !== 'brand-visual') return true;
  const requiresPositioning = selectedModuleIds.some(
    (moduleId) => LONG_TERM_VISUAL_MODULES.has(moduleId),
  );
  if (!requiresPositioning) return true;
  const positioningArtifact = upstreamArtifacts.find((artifact) => (
    artifact.sourceOrganizationId === 'ai-brand-officer'
    && BRAND_POSITIONING_ARTIFACT_IDS.has(artifact.artifactId)
    && Number.isSafeInteger(artifact.version)
    && artifact.version >= 1
    && typeof artifact.sha256 === 'string'
    && SHA256.test(artifact.sha256)
  ));
  if (positioningArtifact === undefined) {
    throw new Error(
      'long-term brand visual modules require an exact brand-positioning artifact from ai-brand-officer',
    );
  }
  return true;
}

export function normalizeRoutingText(value) {
  if (typeof value !== 'string') {
    throw new TypeError('routing text must be a string');
  }
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

export function classifyBrandRoutingReason({
  skillId,
  goal,
  selectedModuleIds,
}) {
  validateSkillId(skillId);
  const permitted = new Set(BRAND_SKILL_MODULES[skillId]);
  if (
    !Array.isArray(selectedModuleIds)
    || selectedModuleIds.length === 0
    || selectedModuleIds.some((moduleId) => !permitted.has(moduleId))
    || new Set(selectedModuleIds).size !== selectedModuleIds.length
  ) {
    throw new TypeError('selectedModuleIds must be unique modules for skillId');
  }
  const keywordSelected = selectKeywordModules(skillId, goal);
  if (
    keywordSelected.length > 0
    && sameSet(selectedModuleIds, keywordSelected)
  ) {
    return 'goal-keyword-match';
  }
  if (
    keywordSelected.length === 0
    && sameSet(selectedModuleIds, BRAND_SKILL_MODULES[skillId])
  ) {
    return 'full-skill-fallback';
  }
  return 'explicit-modules';
}

function selectKeywordModules(skillId, goal) {
  const normalizedText = normalizeRoutingText(goal);
  const compactText = normalizedText.replace(/\s+/gu, '');
  if (skillId === 'brand-positioning') {
    return resolvePositioningGoal(goal).selectedModuleIds;
  }
  return selectGenericKeywordModules(skillId, normalizedText, compactText);
}

function selectGenericKeywordModules(skillId, normalizedText, compactText) {
  return BRAND_SKILL_MODULES[skillId].filter(
    (moduleId) => ROUTING_KEYWORDS[skillId][moduleId].some((keyword) => (
      routingKeywordMatches(normalizedText, compactText, keyword)
    )),
  );
}

function resolvePositioningGoal(goal) {
  const normalizedText = normalizeRoutingText(goal);
  const compactText = normalizedText.replace(/\s+/gu, '');
  const supportingRoutes = matchPositioningSupportingRoutes(compactText);
  const selected = new Set(
    selectGenericKeywordModules(
      'brand-positioning',
      normalizedText,
      compactText,
    ),
  );
  for (const { moduleIds } of supportingRoutes) {
    for (const moduleId of moduleIds) selected.add(moduleId);
  }
  return {
    supportingRoutes,
    selectedModuleIds: BRAND_SKILL_MODULES['brand-positioning'].filter(
      (moduleId) => selected.has(moduleId),
    ),
  };
}

function matchPositioningSupportingRoutes(compactText) {
  return POSITIONING_SUPPORTING_ROUTES
    .filter(
      ({ triggers }) => triggers.some(
        (trigger) => compactText.includes(trigger),
      ),
    )
    .map((route) => {
      const selected = new Set(route.moduleIds);
      if (
        route.optionalAudienceTriggers?.some(
          (trigger) => compactText.includes(trigger),
        )
      ) selected.add('audience-positioning');
      if (
        route.optionalMindshareTriggers?.some(
          (trigger) => compactText.includes(trigger),
        )
      ) selected.add('mindshare-occupation');
      return {
        ...route,
        moduleIds: BRAND_SKILL_MODULES['brand-positioning'].filter(
          (moduleId) => selected.has(moduleId),
        ),
      };
    });
}

function routingKeywordMatches(normalizedText, compactText, keyword) {
  const normalizedKeyword = normalizeRoutingText(keyword);
  if (ASCII_KEYWORD.test(normalizedKeyword)) {
    const escapedKeyword = escapeRegularExpression(normalizedKeyword);
    return new RegExp(
      `(?<![a-z0-9])${escapedKeyword}(?![a-z0-9])`,
      'u',
    ).test(normalizedText);
  }
  const compactKeyword = normalizedKeyword.replace(/\s+/gu, '');
  if (/[a-z0-9]/u.test(compactKeyword)) {
    const mixedPattern = compactKeyword
      .match(/[a-z0-9]+|[^a-z0-9]+/gu)
      .map((part) => (
        ASCII_KEYWORD.test(part)
          ? `(?<![a-z0-9])${escapeRegularExpression(part)}(?![a-z0-9])`
          : escapeRegularExpression(part)
      ))
      .join('\\s*');
    return new RegExp(mixedPattern, 'u').test(normalizedText);
  }
  return compactText.includes(compactKeyword);
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeJsonInput(value, label) {
  assertPlain(value, label);
  const normalized = cloneStableJson(value, label, 1, new Set());
  const serialized = stableStringify(normalized);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_BYTES) {
    throw new TypeError(`${label} stable JSON must not exceed 1 MB`);
  }
  return normalized;
}

function cloneStableJson(value, label, depth, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be stable JSON with finite numbers`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${label} must be stable JSON without function or symbol values`);
  }
  if (depth > MAX_JSON_DEPTH) {
    throw new TypeError(`${label} stable JSON must not exceed depth ${MAX_JSON_DEPTH}`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} stable JSON contains a circular reference`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} stable JSON must not contain symbol keys`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const names = Object.getOwnPropertyNames(value);
      const permitted = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index)),
      ]);
      if (names.some((name) => !permitted.has(name))) {
        throw new TypeError(`${label} stable JSON array has extra properties`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const clone = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) {
          throw new TypeError(`${label} stable JSON does not support sparse arrays`);
        }
        assertDataDescriptor(descriptor, `${label}[${index}]`);
        clone.push(cloneStableJson(
          descriptor.value,
          `${label}[${index}]`,
          depth + 1,
          ancestors,
        ));
      }
      return clone;
    }

    assertPlain(value, label);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(value);
    if (keys.length > MAX_JSON_PROPERTIES) {
      throw new TypeError(
        `${label} stable JSON objects must not exceed ${MAX_JSON_PROPERTIES} properties`,
      );
    }
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = descriptors[name];
      assertDataDescriptor(descriptor, `${label}.${name}`);
      if (!descriptor.enumerable) {
        throw new TypeError(`${label}.${name} must be an enumerable JSON property`);
      }
    }
    const clone = {};
    for (const key of keys) {
      clone[key] = cloneStableJson(
        descriptors[key].value,
        `${label}.${key}`,
        depth + 1,
        ancestors,
      );
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function assertDataDescriptor(descriptor, label) {
  if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
    throw new TypeError(`${label} accessor properties are unsupported`);
  }
}

function sameSet(first, second) {
  return (
    first.length === second.length
    && first.every((value) => second.includes(value))
  );
}

function buildRequiredEvidence({
  skillId,
  selectedModuleIds,
  availableInputs,
  constraints,
  supportingRoutes,
}) {
  return [
    {
      requirementId: 'feishu-knowledge-preflight',
      category: 'feishu',
      description:
        '执行飞书知识前置检索并保存真实来源凭证；no_hit 或 degraded 时如实记录并继续。',
      mandatory: true,
    },
    {
      requirementId: 'exact-upstream-artifacts',
      category: 'upstream-artifact',
      description:
        '所有上游成果必须绑定 artifactId@version 与 SHA-256；无上游时明确记录无依赖。',
      mandatory: true,
    },
    {
      requirementId: 'task-context-snapshot',
      category: 'conversation',
      description:
        `可用输入 SHA-256：${stableSha256(availableInputs)}；任务约束 SHA-256：${stableSha256(constraints)}。`,
      mandatory: true,
    },
    {
      requirementId: 'selected-module-evidence-bundle',
      category: 'professional-judgment',
      description:
        `${SKILL_LABELS[skillId]}选中模块 ${selectedModuleIds.join(', ')} 的事实、来源、推断、假设与未知项必须逐模块分开记录。`,
      mandatory: true,
    },
    ...(supportingRoutes.length === 0 ? [{
      requirementId: 'evidence-classification',
      category: 'professional-judgment',
      description:
        '证据必须区分企业事实、飞书原文、对话补充、互联网来源与专业判断。',
      mandatory: true,
    }] : supportingRoutes.map((supportingRoute) => ({
      requirementId: `supporting-step-${supportingRoute.id}`,
      category: 'professional-judgment',
      description:
        `supportingStep ${supportingRoute.id} 的输入与证据：${supportingRoute.evidence}`,
      mandatory: true,
    }))),
  ];
}

function buildAcceptanceCriteria(
  skillId,
  selectedModuleIds,
  supportingRoutes,
  ownershipHandoffOrganizationIds = [],
  communicationUpstream = {
    visualStatus: null,
  },
) {
  return [
    '飞书知识前置状态、来源与降级限制已真实记录。',
    '上游成果均使用精确 artifactId@version 和 SHA-256，未引用 current 或 latest。',
    `选中模块完成标准：${selectedModuleIds.map(
      (moduleId) => `${moduleId}=${MODULE_ACCEPTANCE[moduleId]}`,
    ).join('；')}`,
    ...supportingRoutes.map((supportingRoute) => (
      `supportingStep ${supportingRoute.id} 完成标准：${supportingRoute.acceptance}`
    )),
    ...(supportingRoutes.length === 0 ? [
      '未命中专项支撑步骤时，仍须完成全部选中模块的证据闭环。',
    ] : []),
    ...ownershipHandoffOrganizationIds.map(
      communicationOwnershipHandoffCriterion,
    ),
    ...(communicationUpstream.visualStatus === null ? [] : [
      communicationVisualAcceptanceCriterion(
        communicationUpstream.visualStatus,
      ),
    ]),
    `${SKILL_LABELS[skillId]}候选已完成规则审核与品牌专业审核，两类审核均可追溯；结论区分事实、专业判断、推断、假设与未知，不虚构依据。`,
  ];
}

function analyzeCommunicationOwnership({ skillId, goal }) {
  if (skillId !== 'brand-communication') {
    return {
      brandModuleIds: [],
      handoffOrganizationIds: [],
      pureMismatchOrganizationIds: [],
    };
  }
  const normalizedText = normalizeRoutingText(goal);
  const compactText = normalizedText.replace(/\s+/gu, '');
  const brandModuleIds = selectGenericKeywordModules(
    skillId,
    normalizedText,
    compactText,
  );
  const handoffOrganizationIds = [];
  const ownershipFragments = splitOwnershipFragments(normalizedText);
  if (ownershipFragments.some((fragment) => (
    containsAffirmedTermInFragment(fragment, GROWTH_CHANNEL_TERMS)
    && containsAffirmedTermInFragment(
      fragment,
      GROWTH_OPERATION_TERMS,
    )
  ))) {
    handoffOrganizationIds.push('ai-growth-strategist');
  }
  if (ownershipFragments.some((fragment) => (
    containsAffirmedTermInFragment(fragment, DEAL_OWNERSHIP_TERMS)
  ))) {
    handoffOrganizationIds.push('ai-deal-officer');
  }
  return {
    brandModuleIds,
    handoffOrganizationIds,
    pureMismatchOrganizationIds:
      brandModuleIds.length === 0
        ? handoffOrganizationIds
        : [],
  };
}

function splitOwnershipFragments(normalizedText) {
  return normalizedText
    .split(
      /[，。；,;!?！？]+|但(?:是)?|不过|然而|而是|同时|然后|改为|转为|改做|转做|恢复|重启|\b(?:but|however|instead|while|then)\b/giu,
    )
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);
}

function containsAffirmedTermInFragment(fragment, terms) {
  return terms.some((term) => {
    let index = fragment.indexOf(term);
    while (index !== -1) {
      if (!termIsNegatedInFragment(fragment, index)) return true;
      index = fragment.indexOf(term, index + term.length);
    }
    return false;
  });
}

function termIsNegatedInFragment(fragment, termIndex) {
  const prefix = fragment.slice(0, termIndex);
  return [
    '不需要',
    '不考虑',
    '不运营',
    '不要',
    '无需',
    '不做',
    '暂不',
    '不再',
    '停止',
    '取消',
    '避免',
    '排除',
    '禁止',
    '未',
    '不',
  ].some((negation) => prefix.lastIndexOf(negation) !== -1);
}

function rejectPureCommunicationOwnershipMismatch({ skillId, ownership }) {
  if (
    skillId !== 'brand-communication'
    || ownership.pureMismatchOrganizationIds.length === 0
  ) return;
  const owners = [...ownership.pureMismatchOrganizationIds];
  const error = new Error(
    `ownership mismatch: brand-communication cannot execute this request; reassign through control center to ${owners.join(', ')}`,
  );
  error.code = 'ownership_mismatch';
  error.ownerOrganizationIds = owners;
  if (owners.length === 1) {
    [error.ownerOrganizationId] = owners;
  }
  error.receivedSkillId = skillId;
  throw error;
}

function communicationOwnershipHandoffCriterion(organizationId) {
  if (organizationId === 'ai-growth-strategist') {
    return 'ownership handoff: ai-growth-strategist 承接小红书、抖音、视频号、公众号、社群、私域、直播、信息流和账号矩阵的日更、运营、种草、投放、获客、引流、排期与广告；AI品牌官只执行命中的品牌模块。';
  }
  if (organizationId === 'ai-deal-officer') {
    return 'ownership handoff: ai-deal-officer 承接销售沟通、成交话术、成交脚本与成交策略；AI品牌官只提供事实锁、语气和禁语。';
  }
  throw new Error(`unknown ownership handoff organization: ${organizationId}`);
}

export function assertCommunicationUpstreamPrerequisite({
  skillId,
  selectedModuleIds,
  upstreamArtifacts,
}) {
  if (skillId !== 'brand-communication') {
    return {
      positioningArtifact: null,
      visualArtifact: null,
      visualStatus: null,
    };
  }
  const positioningArtifact = upstreamArtifacts.find((artifact) => (
    artifact.sourceOrganizationId === 'ai-brand-officer'
    && BRAND_POSITIONING_ARTIFACT_IDS.has(artifact.artifactId)
  ));
  if (positioningArtifact === undefined) {
    throw new Error(
      'brand-communication requires an exact brand-positioning artifact from ai-brand-officer',
    );
  }
  const visualArtifact = upstreamArtifacts.find((artifact) => (
    artifact.sourceOrganizationId === 'ai-brand-officer'
    && BRAND_VISUAL_ARTIFACT_IDS.has(artifact.artifactId)
  ));
  const requiresVisual = selectedModuleIds.some(
    (moduleId) => [
      'content-communication',
      'brand-campaign',
    ].includes(moduleId),
  );
  if (requiresVisual && visualArtifact === undefined) {
    throw new Error(
      'brand-communication content-communication or brand-campaign requires an exact brand-visual artifact from ai-brand-officer',
    );
  }
  return {
    positioningArtifact,
    visualArtifact: visualArtifact ?? null,
    visualStatus: visualArtifact === undefined
      ? 'not-applicable-pending'
      : 'bound',
  };
}

function communicationVisualAcceptanceCriterion(status) {
  if (status === 'bound') {
    return 'brand-visual upstream is bound by exact artifactId@version and SHA-256.';
  }
  if (status === 'not-applicable-pending') {
    return 'brand-visual is not-applicable for this brand-story or founder-ip-only task and remains 待后续；不得伪装已绑定。';
  }
  throw new Error(`unknown communication visual status: ${status}`);
}

function buildStopConditions(supportingRoutes) {
  const businessDirectionCondition = supportingRoutes.length === 0
    ? '业务方向存在会实质改变最终结果的歧义时停止，请求最少必要确认。'
    : [
      '业务方向存在会实质改变最终结果的歧义时停止',
      ...supportingRoutes.map(
        (supportingRoute) => (
          `supportingStep ${supportingRoute.id} 专项条件：${supportingRoute.stop}`
        ),
      ),
    ].join('；');
  return [
    '同一根因连续修复三轮仍失败时停止自动循环，保留证据并移交。',
    businessDirectionCondition,
    '涉及付费或正式对外发布时停止，取得明确授权后方可继续。',
    '涉及账号、密钥或权限变更时停止，取得明确授权后方可继续。',
    '涉及不可逆删除、覆盖或跨企业读取时立即停止。',
  ];
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
