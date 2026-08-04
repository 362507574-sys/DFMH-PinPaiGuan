import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { writeJsonAtomic } from './atomic_store.mjs';

export const KNOWLEDGE_STATUSES = Object.freeze([
  'matched', 'no_hit', 'degraded', 'skipped_non_business',
]);

const STATUS_SET = new Set(KNOWLEDGE_STATUSES);

export function createKnowledgeContext(value) {
  assertPlain(value, 'knowledge context');
  const status = boundedText(value.status, 50, 'status');
  if (!STATUS_SET.has(status)) throw new Error('knowledge context status is invalid');
  const context = {
    schemaVersion: 1,
    requestId: boundedText(value.requestId, 300, 'requestId'),
    generatedAt: validDateText(value.generatedAt),
    status,
    taskSummary: boundedText(value.taskSummary, 1_000, 'taskSummary'),
    capabilityId: boundedText(value.capabilityId, 200, 'capabilityId'),
    spaces: normalizeSpaces(value.spaces),
    queries: normalizeStrings(value.queries, 2, 500, 'queries'),
    sources: normalizeSources(value.sources),
    unreadCandidates: normalizeUnread(value.unreadCandidates),
    degradedReason: optionalText(value.degradedReason, 100, 'degradedReason'),
  };
  if (status === 'matched' && context.sources.length === 0) {
    throw new Error('matched knowledge context requires sources');
  }
  if (status !== 'matched' && context.sources.length !== 0) {
    throw new Error('non-matched knowledge context cannot contain sources');
  }
  if (status === 'degraded' && !context.degradedReason) {
    throw new Error('degraded knowledge context requires a reason');
  }
  return deepFreeze(context);
}

export function renderKnowledgeContext(context, { maxChars = 5_000 } = {}) {
  const value = createKnowledgeContext(context);
  if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 5_000) {
    throw new TypeError('knowledge context render limit is invalid');
  }
  const names = value.spaces.map((item) => item.name).join('、') || '无';
  const queries = value.queries.join('；') || '无';
  let body;
  if (value.status === 'matched') {
    const sources = value.sources.map((source) => (
      `- [${source.spaceName}｜${source.title}](${source.url || source.token})\n  ${source.excerpt}`
    )).join('\n');
    body = [
      '## 飞书知识前置检索',
      '状态：matched',
      `查询空间：${names}`,
      `查询词：${queries}`,
      '',
      '### 可引用知识',
      sources,
      '',
      '使用要求：区分知识库原文、基于原文的推断、网络资料和一般专业判断。',
    ].join('\n');
  } else if (value.status === 'no_hit') {
    body = [
      '## 飞书知识前置检索',
      '状态：no_hit',
      `查询空间：${names}`,
      `查询词：${queries}`,
      '本次未找到可直接使用的相关知识；继续完成任务，不得伪造知识库依据。',
    ].join('\n');
  } else if (value.status === 'skipped_non_business') {
    body = '## 飞书知识前置检索\n状态：skipped_non_business\n本次不包含业务任务，无需读取知识库正文。';
  } else {
    body = [
      '## 飞书知识前置检索',
      '状态：degraded',
      `查询空间：${names}`,
      `降级原因：${value.degradedReason}`,
      '飞书知识查询暂时不可用；继续完成任务，不得把未查询内容描述为知识库依据。',
    ].join('\n');
  }
  return body.slice(0, maxChars);
}

export async function writeKnowledgeContextAtomic({
  projectRoot,
  evidencePath,
  context,
} = {}) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw new TypeError('projectRoot must be absolute');
  }
  if (typeof evidencePath !== 'string' || !evidencePath || path.isAbsolute(evidencePath)) {
    throw new TypeError('knowledge evidencePath must be project-relative');
  }
  const root = await realpath(projectRoot);
  if (!(await stat(root)).isDirectory()) throw new Error('projectRoot must be a directory');
  const target = path.resolve(root, evidencePath);
  if (!inside(root, target) || path.extname(target).toLowerCase() !== '.json') {
    throw new Error('knowledge evidence path is unsafe');
  }
  const normalized = createKnowledgeContext(context);
  await writeJsonAtomic(target, normalized);
  return target;
}

function normalizeSpaces(value) {
  if (!Array.isArray(value) || value.length > 20) throw new TypeError('spaces must be an array');
  return value.map((item) => {
    assertPlain(item, 'knowledge space');
    return {
      name: boundedText(item.name, 100, 'space name'),
      spaceId: boundedText(item.spaceId, 64, 'space id'),
    };
  });
}

function normalizeSources(value) {
  if (!Array.isArray(value) || value.length > 3) throw new TypeError('sources must be a bounded array');
  return value.map((item) => {
    assertPlain(item, 'knowledge source');
    return {
      spaceName: boundedText(item.spaceName, 100, 'source spaceName'),
      title: boundedText(item.title, 500, 'source title'),
      url: optionalText(item.url, 2_000, 'source url'),
      token: optionalText(item.token, 512, 'source token'),
      docType: boundedText(item.docType, 50, 'source docType'),
      excerpt: boundedText(item.excerpt, 1_500, 'source excerpt').slice(0, 1_500),
    };
  });
}

function normalizeUnread(value) {
  if (!Array.isArray(value) || value.length > 5) throw new TypeError('unreadCandidates must be bounded');
  return value.map((item) => {
    assertPlain(item, 'unread candidate');
    return {
      title: boundedText(item.title, 500, 'unread title'),
      reason: boundedText(item.reason, 100, 'unread reason'),
    };
  });
}

function normalizeStrings(value, maximum, limit, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} must be bounded`);
  return value.map((item) => boundedText(item, limit, label));
}

function validDateText(value) {
  const text = boundedText(value, 100, 'generatedAt');
  if (Number.isNaN(Date.parse(text))) throw new TypeError('generatedAt is invalid');
  return text;
}

function assertPlain(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function boundedText(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\u0000')) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function optionalText(value, limit, label) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > limit || value.includes('\u0000')) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
