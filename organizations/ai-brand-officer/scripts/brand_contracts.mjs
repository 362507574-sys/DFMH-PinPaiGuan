import { createHash } from 'node:crypto';
import path from 'node:path';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const WINDOWS_DEVICE_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/u;

export const BRAND_SKILL_MODULES = Object.freeze({
  'brand-positioning': Object.freeze([
    'category-positioning',
    'audience-positioning',
    'differentiation-positioning',
    'mindshare-occupation',
  ]),
  'brand-visual': Object.freeze([
    'visual-identity-system',
    'store-identity',
    'poster-art-direction',
    'product-packaging',
    'ai-visual-generation',
  ]),
  'brand-communication': Object.freeze([
    'content-communication',
    'brand-campaign',
    'brand-story',
    'founder-ip-communication',
  ]),
});

export function validateTaskIdentity(value) {
  assertPlain(value, 'task identity');
  rejectUnknown(
    value,
    ['enterpriseId', 'businessProjectId', 'taskId'],
    'task identity',
  );
  return Object.freeze({
    enterpriseId: safeId(value.enterpriseId, 'enterpriseId'),
    businessProjectId: safeId(value.businessProjectId, 'businessProjectId'),
    taskId: safeId(value.taskId, 'taskId'),
  });
}

export function stableSha256(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function stableStringify(value) {
  return serializeStableJson(value, new Set());
}

export function safeId(value, label = 'id') {
  if (
    typeof value !== 'string'
    || value === '.'
    || value === '..'
    || !SAFE_ID.test(value)
    || value.endsWith('.')
    || WINDOWS_DEVICE_NAME.test(value)
    || path.basename(value) !== value
    || value.includes('/')
    || value.includes('\\')
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return value;
}

export function assertPlain(value, label = 'value') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

export function rejectUnknown(value, allowed, label = 'value') {
  const allowedFields = allowed instanceof Set ? allowed : new Set(allowed);
  const extra = Object.keys(value).find((key) => !allowedFields.has(key));
  if (extra) throw new Error(`${label} has unknown field: ${extra}`);
}

function serializeStableJson(value, ancestors) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('value must be stable JSON');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError('value must be stable JSON');
  }
  if (ancestors.has(value)) throw new TypeError('value contains a circular reference');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError('value must be stable JSON; sparse arrays are unsupported');
        }
      }
      const permittedNames = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index)),
      ]);
      if (
        Object.getOwnPropertyNames(value).some((key) => !permittedNames.has(key))
        || Object.getOwnPropertySymbols(value).length > 0
      ) {
        throw new TypeError(
          'value must be stable JSON; extra array properties are unsupported',
        );
      }
      return `[${value.map((item) => serializeStableJson(item, ancestors)).join(',')}]`;
    }

    assertPlain(value, 'value for stable JSON');
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('value must be stable JSON; symbol keys are unsupported');
    }
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeStableJson(value[key], ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
