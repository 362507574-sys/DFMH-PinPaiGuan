# 帝王项目审美档案模板

以下 YAML 是固定结构；不得增加跨企业推断字段，也不得把行为数据冒充帝王明确反馈。

```yaml
schemaVersion: 1
enterpriseId:
businessProjectId:
brandId:
approvedCases:
  - caseId:
    artifactRef:
    likedElements:
    transferablePrinciples:
rejectedCases:
  - caseId:
    artifactRef:
    dislikedElements:
    avoidPrinciples:
activePreferences:
forbiddenDirections:
updatedFromExplicitFeedbackOnly: true
crossProjectReuse: forbidden
```

## 写入规则

1. 只有帝王对实际候选作出明确通过或明确否决后才能写入 `approvedCases` / `rejectedCases`。
2. 不从沉默、停留时长、单次点击、下载、滚动、历史默认选项或执行者猜测推断偏好。
3. 每个 `artifactRef` 必须绑定当前项目的 `artifactId@version` 与 `sha256`；无法精确定位的案例不得写入。
4. `likedElements` / `dislikedElements` 记录可观察特征；`transferablePrinciples` / `avoidPrinciples` 才记录经过同项目复核的可执行原则。
5. `activePreferences` 与 `forbiddenDirections` 必须注明适用品牌、渠道、用途和时间，不得写“帝王永远喜欢/不喜欢”。

## 隔离与复用

档案只属于其 `enterpriseId + businessProjectId + brandId`。禁止跨项目自动复用，也禁止跨企业读取。确需复用时只能由总控建立固定导入快照，并绑定来源项目、`artifactId@version` 与 `sha256`；导入仍不覆盖当前项目的明确反馈。

审美偏好永远不能推翻产品原貌、事实证据、授权、安全、精确文字、定位、法规和生产边界。
