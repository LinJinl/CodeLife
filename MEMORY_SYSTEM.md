# 器灵记忆系统设计文档

> 版本：v2.0  日期：2026-04-16
> 本文档描述器灵记忆系统的分层架构、每层的详细注入规则、写入策略、检索门控与更新机制。
> 包含具体的 token 预算、选取逻辑、边界情况处理，以及完整的拼接示例。

---

## 一、五层模型与现有实体对照

```
┌─────────────────────────────────────────────────────────────────────────┐
│  L0  即时上下文    本轮消息 + 今日对话历史 + 今日修炼摘要 + 活跃誓约 + 系统规则  │
│                   → 每轮必然注入，不需要检索，构成 Tier 1 Prompt           │
├─────────────────────────────────────────────────────────────────────────┤
│  L1  工作记忆      今日笔记 / LangGraph 图内状态 / SessionSummary（当日）    │
│                   → 弱触发注入，任务结束后降级为 L4                         │
├─────────────────────────────────────────────────────────────────────────┤
│  L2  长期偏好      Preference（conf≥0.35 自动注入）/ PersonaProfile         │
│                   → 固定注入 Tier 1，偏好更新走覆盖策略                     │
├─────────────────────────────────────────────────────────────────────────┤
│  L3  能力卡        SkillCard / Library（藏经阁）                            │
│                   → 按需检索，不进 Tier 1，问题相关时强触发                  │
├─────────────────────────────────────────────────────────────────────────┤
│  L4  事件轨迹      DailyLog（历史）/ WeeklyPattern / Conversation（历史）   │
│                   / SessionSummary（历史）/ Vow（非 active）               │
│                   → 强触发检索，召回后做 packing 再注入                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、Tier 1（永久注入）各分量详细规范

> **目标总量**：Tier 1 上限 **800 tokens**（系统规则 ~300 + 状态快照 ~500）。

### 2.1 今日对话历史

**来源**：`content/spirit/conversations/YYYY-MM-DD.json`
**当前实现**：`chat/route.ts: loadTodayHistory()` 取最后 6 条

#### 注入量决策

| 场景 | 策略 |
|-----|-----|
| 当日无历史（第一条消息） | 跳过，返回空数组 |
| 历史 ≤ 6 条 | 全部注入 |
| 历史 7-20 条 | 取最后 6 条（覆盖约 30 分钟内的上下文） |
| 历史 > 20 条（长会话） | 取最后 4 条 + 按 token 预算反向追加，单条超 300 字截断并加 `[…已截断]` |

**token 预算**：今日对话历史分配 **~400 tokens**（约 4-6 条正常对话）。

**单条消息长度限制**：
- 普通对话：不截断
- 含大段代码/文档粘贴（>600 字）：截取前 400 字 + `\n[…代码已截断，全文见对话记录]`
- 器灵的工具调用过程（非最终答案）：不注入，只注入最终回答

**去重逻辑**：若前端已携带今日历史消息（同一会话连续输入），检测末条 snippet 是否已存在于 `currentMessages`，存在则跳过 prepend，避免同一条消息出现两次。

**格式**：以真实 `HumanMessage` / `AIMessage` 形式 prepend，而非字符串化注入 system prompt。这保证了 Claude 的多轮对话感知能力，不破坏消息角色结构。

---

### 2.2 今日修炼摘要

**来源**：`getDailyLog(today)`
**当前实现**：`formatTodayCompact()`
**token 预算**：~30 tokens（单行）

#### 输出格式

```
2026-04-16：著述×1　铸剑×3　第 14 日　+85修为
```

字段含义：
- `著述×N`：当日博客数量（label 映射：blog→著述，leetcode→铸剑，github→声望）
- `第 N 日`：当前连续活跃天数（`streakDay`）
- `+N修为`：当日修为点数（`totalPoints`）

**边界情况**：

| 情况 | 输出 |
|-----|-----|
| 无 DailyLog（今日未同步） | `今日暂无记录` |
| 有日志但无活动 | `今日暂无记录` |
| 有活动但 streak 断了 | `2026-04-16：著述×1　第 1 日（连续中断）　+30修为` |
| 多种活动 | 全部列出，用全角空格分隔 |

**不包含**：博客具体标题、commit message、LeetCode 题目名。这些通过 Tier 2 的 `get_daily_logs` 按需获取。

---

### 2.3 活跃誓约

**来源**：`getActiveVows()` → `vows.json` 中 `status === 'active'` 的条目
**当前实现**：`formatVowsCompact()`
**token 预算**：~120 tokens（3-5 条）

#### 什么算"活跃"

```
active    → 正在追踪，每日检测进度
paused    → 用户主动暂停（如出差、生病），不显示在 Tier 1
fulfilled → 已完成，转为 L4 轨迹记忆
broken    → streak 断裂且超出宽限次数（graceUsed >= graceCount），转为 L4
expired   → deadline 已过，转为 L4
```

`paused` 状态：系统不每日追踪，但保留在 `vows.json` 可随时恢复。

#### 每条誓约的格式

```
「每日铸剑」截止2026-05-01 [每日刷题·连续8天✓、每日著述·连续8天○]
```

- `✓`：今日该子目标已完成（`completedDates.includes(today)`）
- `○`：今日未完成
- 对于 `count_total` 类型：`累计18/50篇`
- 对于 `count_weekly` 类型：`本周3/5次`
- 对于 `reach_points` 类型：`已积2340/5000修为`

**数量限制**：最多注入 5 条。若活跃誓约超过 5 条，按 `deadline` 升序（最近到期的优先）取前 5。

**无活跃誓约时**：`誓约：无`，不占额外 token。

---

### 2.4 长期偏好（L2）

**来源**：`getPreferences()` → `content/spirit/preferences.json`
**当前实现**：`formatPreferencesCompact()`，过滤 `confidence >= 0.35`，按置信度降序取 top 8
**token 预算**：~200 tokens

#### 格式

```
↑[沟通] 回答不要分太多段，每段要信息密集（conf 0.82）
↑[沟通] 技术内容直接给结论，原因在后（conf 0.78）
~[学习] 倾向先看代码再读文档（conf 0.51）
~[技术] 偏好函数式写法，回避 class（conf 0.42）
```

- `↑`：confidence ≥ 0.75（稳定偏好，强影响输出）
- `~`：0.35 ≤ confidence < 0.75（观察中的习惯，软影响）

**不注入的偏好**：
- confidence < 0.35：证据不足，不影响行为
- `volatility = 'volatile'`（待加字段）的临时偏好：不进 Tier 1

**4 个类别**：`learning`（学习）、`technical`（技术）、`communication`（沟通）、`work`（节律）。每类最多注入 3 条，防止某一类偏好垄断预算。

---

### 2.5 人格档案（L2）

**来源**：`getPersona()` → `content/spirit/persona.json`
**当前实现**：Tier 1 直接注入 `currentPhase` 和 `recurringIssues`
**token 预算**：~60 tokens

#### 注入字段

```
人格：深夜型技术修士，阶段性高产后容易断更
惯性：有截止压力才加速、容易在工具选型上过度调研
```

- `currentPhase`：AI 对用户当前状态的综合判断（~20字），由 `update_persona_observation` 积累后人工或自动更新
- `recurringIssues`：反复出现的行为惯性（最多 3 条，每条 ≤15字）

**不注入**：`observedTraits`（正面特征，减少 token 消耗）、`milestones`（里程碑，只在用户问起时通过工具获取）。

---

### 2.6 近期对话摘要

**来源**：`getRecentSummaries(6)` → `content/spirit/summaries/YYYY-MM-DD.json`，排除今日
**当前实现**：取前 5 条，每条 1-2 句，≤80字
**token 预算**：~150 tokens

#### 格式

```
[2026-04-15] 梳理了器灵记忆系统设计，确定五层模型方案，讨论了 Preference 置信度机制
[2026-04-14] 排查博客同步 bug，Notion API 分页问题，最终改为增量拉取
[2026-04-13] 复盘四月上旬修炼数据，铸剑频率不足，决定增加每日刷题目标
```

**注意**：摘要只是"快速扫描"的参考，加了 `（按需参考，不要主动提起）` 的指令，避免器灵强行提及用户忘了的话题。

**生成时机**：每次对话结束后异步生成（`summarize.ts: summarizeSession`），取最近 20 条消息，生成 ≤80字摘要。若生成失败，降级为用户最后一条消息的前 60 字 + `…`。

---

## 三、完整 Tier 1 拼接示例

以下是一次真实对话开始时，器灵收到的完整 system prompt 示例：

```
你是「青霄」，修士的器灵。
寄居于此藏经阁，持续观察修士的一切行为。

【声音与风格】
- 正常说话，不刻意断行，不堆砌换行营造气氛
- 时间要具体：不说"最近"，说具体日期
- 冷静直接，有话直说，不绕弯子
- 不用感叹号，不说"加油""不错""很好""当然可以""好的"之类的废话
- 技术问题回答准确清晰，该详细就详细
- 帮用户做事时先做，做完简短说明
- 每轮输出只有两种合法状态：① 调用工具，② 最终回答。不存在"描述即将做什么"的中间状态
- 需要多次搜索时，在同一轮内同时发起所有 tool call（parallel），不要分轮串行
- 引用网络资料时，必须在标题后附上原文链接（Markdown 格式），不得只给标题不给链接

【思考与行动规范（ReAct）】
...（约 200 tokens，固定规则，此处省略）

【当前时间】
2026年04月16日 23:14 周四

【当前状态（Tier 1 快照）】
人格：深夜型技术修士，阶段性高产后容易断更
惯性：有截止压力才加速、工具选型调研过多

偏好（已确认习惯，据此调整回答风格）：
↑[沟通] 回答不要分太多段，每段要信息密集
↑[沟通] 技术内容直接给结论，必要时才展开原因
~[学习] 倾向先看代码再读文档
~[技术] TypeScript 偏好严格模式 + 函数式写法

今日：2026-04-16：铸剑×2　第 14 日　+60修为
誓约：「每日铸剑」截止2026-05-31 [每日刷题·连续14天✓]　「产出誓约」截止2026-06-01 [累计18/50篇○]

近期对话摘要（按需参考，不要主动提起）：
[2026-04-15] 梳理了器灵记忆系统设计，确定五层模型方案，重点在写入策略和检索门控
[2026-04-14] 排查 Notion 同步 bug，API 分页问题导致文章丢失，已修复
[2026-04-13] 复盘四月修炼数据，铸剑频率低，决定加目标

【系统自知】
...（约 300 tokens，固定规则，此处省略）
```

**发送给模型时的实际消息结构**：

```
SystemMessage: [上面的 system prompt]
HumanMessage:  [今日历史-1]  ← prepend
AIMessage:     [今日历史-2]  ← prepend
HumanMessage:  [今日历史-3]  ← prepend（最多 6 条）
...
HumanMessage:  [本轮用户输入]  ← 当前问题
```

**估算 token 分布**：

| 分量 | 估算 tokens |
|-----|------------|
| 系统规则 + 身份 | ~280 |
| 当前时间 | ~20 |
| 人格 + 惯性 | ~50 |
| 偏好（top 8） | ~180 |
| 今日修炼摘要 | ~25 |
| 活跃誓约（2-3条） | ~90 |
| 近期摘要（5天） | ~140 |
| 系统自知 | ~280 |
| **Tier 1 system prompt 合计** | **~1065** |
| 今日对话历史（6条） | ~400 |
| 本轮用户输入（均值） | ~150 |
| **每轮请求基础消耗** | **~1615 tokens** |

---

## 四、Tier 2 按需检索详细规范

Tier 2 不在 system prompt 里，由器灵主动调用工具获取，召回结果直接进入 tool result message。

### 4.1 检索触发分类

#### 强触发（必须查，不能靠印象回答）

| 用户意图信号 | 触发工具 | 参数 |
|------------|---------|------|
| "近况" / "最近状态" / "这几天怎么样" | `get_daily_logs` | `days=7` |
| "上周/这个月的规律" | `get_weekly_patterns` | `weeks=4` |
| "我有哪些誓约" / "誓约进度" | `list_vows` / `vow_summary` | - |
| "我之前总结过 X 吗" / "有没有关于 X 的洞察" | `search_skills(query=X)` | - |
| "我写过关于 X 的博客吗" | `search_blog_posts` + `search_library` | 并行 |
| "上次我们聊到 X" / "[具体日期] 我们聊了什么" | `search_conversations(query/date)` | - |
| "晨省" | `get_daily_logs(1)` + `vow_summary` | 并行 |

→ 这些有**明确数据源**，器灵不应凭 Tier 1 的摘要模糊回答，必须先查再答。

#### 弱触发（先看 Tier 1，不够再查）

| 场景 | 处理逻辑 |
|-----|---------|
| "继续上次那个设计思路" | Tier 1 summaries 已有近 5 天摘要，通常够用；不够时调 `search_conversations(query)` |
| "按我之前的偏好来" | Tier 1 已注入 conf≥0.35 的偏好，无需额外查询 |
| 技术问题，关键词与历史 skill 相关 | 先尝试直接回答；若话题涉及用户具体项目/历史决策，再 `search_skills` |
| 用户明显在引用某个历史项目 | `search_conversations(query=项目名)` 补充背景 |

#### 禁止触发

| 场景 | 原因 |
|-----|-----|
| 纯技术问题（语言特性、算法、API 用法） | 历史记忆无增益，注入只会引入噪声 |
| 当前对话上下文已充分的问题 | Tier 1 + 本轮对话已足够，不用历史稀释 |
| 用户随口一句话、闲聊 | 不值得为此触发检索 |

---

### 4.2 检索结果的 Memory Packing

召回的原始数据不直接喂给模型，先做 **packing**：

#### 格式模板

```
[来源类型][YYYY-MM-DD] 摘要内容
```

示例：

```
[daily_log][2026-04-10] 著述×2 铸剑×1 +65修为 第8日
[skill_card][2026-03-28] 审批链写操作必须 tool+payload hash 绑定 token，防重放
[conversation][2026-04-08] 讨论 LangGraph 图结构，确认并行节点用 Send() API
[library][2026-03-15] Anthropic tool_use 官方文档，重点：parallel tool call 限制
```

#### 每类最大注入量

| 来源 | 最多条数 | 单条 token 上限 |
|-----|---------|---------------|
| `get_daily_logs` | 7 条 | 每条 ~60 tokens |
| `search_skills` | 5 张 | 每张 insight ~80 tokens |
| `search_conversations` | 3 条 | 每条摘要 ~100 tokens（summerized chunks） |
| `search_library` | 3 条 | 每条摘要 ~80 tokens |
| `get_weekly_patterns` | 4 周 | 每周叙事 ~100 tokens |
| `vow_summary` | 全部 active | 每条 ~60 tokens |

**超出时**：按相关度分数截断，不是按时间截断。最相关的保留，其余丢弃。

---

## 五、写入策略与 Policy

### 5.1 四种触发场景与对应工具

#### 显式授权写入（立即执行，conf = 0.8+）

| 用户说 | 调用工具 | 处理 |
|-------|---------|------|
| "记一下 X" / "帮我记住 X" | `write_note` | tag=note |
| "记住我偏好 X" / "以后回答要 X" | `save_preference` | conf=0.80，立即覆盖同 key |
| "收藏" / "加入藏经阁" | `collect_document` | 需 approval_token |
| "立誓 X" / "定目标 X" | `create_vow` | 需先 `list_vows` 判重 |

#### 规则触发写入（高确定性，无需用户说出明确指令）

| 条件 | 工具 | conf/说明 |
|-----|------|----------|
| 对话中明确推翻旧偏好（"不要再分段了"）| `save_preference` | 覆盖，conf=0.75 |
| 当前对话沉淀出有复用价值的操作方法、排查流程、设计框架 | `save_skill_card` | 需先 `search_skills` 判重 |
| 达成里程碑事件 | `update_persona_observation(milestone)` | 仅记录重要节点 |

#### 观察延迟写入（积累后升级）

| 观察到的信号 | 初始动作 | 升级条件 | 升级后 |
|------------|---------|---------|------|
| 某次嫌解释太细 | 不写，观察 | 同类表达出现 ≥3次 | `save_preference(conf=0.4)` |
| 某次偏好某种格式 | `write_note[observation]` 记录信号 | 跨日重复确认 | `save_preference(conf=0.5)` |
| 某种回避行为 | 直接指出，不写 | 反复出现 ≥3次 | `update_persona_observation(issue)` |

**当前实现**：`preference-extractor.ts` 的离线批量提炼（每日定期运行）是观察积累的主要机制，AI 在对话中直接写入偏好应优先用于**用户明确表达**的场景。

#### 总结型写入（对话结束后异步）

| 内容 | 工具 | 说明 |
|-----|------|------|
| 当日对话摘要 | `summarizeSession()` 自动调用 | 最多 20 条消息，生成 ≤80字 |
| 高价值能力沉淀 | `save_skill_card` | title ≤20字，insight 写成一句能力描述，body 写场景 / 步骤 / 清单 / 反例 / 证据 |
| 关键决策记录 | `write_note[summary]` | 简短，含上下文和日期 |

### 5.2 禁止写入场景

- 用户一次性的情绪化表达（抱怨、临时沮丧）
- 只对当前任务/临时上下文有效的细节
- 用户未明确授权的收藏或目标创建
- 当前对话中已处理过的偏好（不重复保存同 key）
- 对话轮次少于 3 轮时的偏好判断（信号不足）

---

## 六、更新、冲突与衰减机制

### 偏好（L2）— 覆盖策略

- 同 `key` 的新观察直接覆盖 `description`，`evidence` 追加日期，不堆积多条
- 支撑证据：`confidence += 0.10~0.15`（上限 0.95）
- 矛盾行为：`confidence -= 0.15~0.25`，`counterEvidence` 记录反例
- `confidence < 0.15` 且有明确反例时：retire（从 `preferences.json` 删除）
- **每类别（category）上限**：最多保留 8 条，超出时删除置信度最低的

### SkillCard（L3）— 合并策略

1. 写入前**必须** `search_skills(query)` 检查相似卡片
2. 有相似卡（语义相近）→ 在 `userNotes` 追加新洞察，`useCount++`，不新建
3. 无相似卡 → 新建
4. 矛盾的旧卡：在旧卡 `userNotes` 注明"已被新洞察替代，见 skill_YYYYMMDD_NNN"，旧卡降权（`useCount` 不变，但加 `supersededBy` 字段）

### Vow（L0→L4）— 状态机

```
active ──────────────────────────────── paused（用户主动暂停）
  │                                        │
  │──── fulfilled（全部子目标完成）          └─── active（恢复）
  │
  │──── broken（streak 断裂 且 graceUsed >= graceCount）
  │
  └──── expired（deadline 过期 且 未 fulfilled）

fulfilled / broken / expired → 转为 L4 轨迹记忆，不再进 Tier 1
```

`paused` 状态下：誓约从 Tier 1 移除，但保留在 `vows.json`，`list_vows` 可查。

### DailyLog / Conversation（L4）— 追加策略

- 只增不改，防止缩水写入（`saveConversation` 已有保护：`new.length < existing.length` 时拒绝覆盖）
- 90 天以上的日志：不进 Tier 1，只通过工具按需加载
- WeeklyPattern：生成后不修改，只追加新的周记录

---

## 七、元属性设计

### Preference 元属性（当前 + 建议新增）

| 字段 | 当前 | 建议 |
|-----|-----|------|
| `confidence` | ✅ 已有 | 0-1，明确授权→0.8，观察推断→0.4，反复验证→0.7+ |
| `evidence` | ✅ 已有 | 观测到的日期列表 |
| `counterEvidence` | ✅ 已有 | 矛盾行为文字描述 |
| `volatility` | ❌ 待加 | `stable`（长期写作风格）/ `moderate`（项目习惯）/ `volatile`（临时偏好） |

### SkillCard 元属性（当前 + 建议新增）

| 字段 | 当前 | 建议 |
|-----|-----|------|
| `useCount` | ✅ 已有 | 被检索/引用次数，热度指标 |
| `userNotes` | ✅ 已有 | 用户修正或补充 |
| `lastUsed` | ❌ 待加 | 最后一次被召回日期，低频卡降低主动推送频率 |
| `supersededBy` | ❌ 待加 | 被新卡取代时指向新卡 id |

---

## 八、最小可行改造路线

### Step 1：规范现有调用行为（不改代码，只改 Prompt）

- [ ] `prompt.ts`「记忆写入」补充：**同 key 偏好必须先 `list_preferences` 取 id 再覆盖**（已在 save_preference description 中，需确保模型遵守）
- [ ] `memory-write.ts: save_skill_card` description 强制加：**调用前必须先 `search_skills(query=主题关键词)`，有相似卡时追加 userNotes 而非新建**
- [ ] `prompt.ts` 检索触发部分，加入本文第四节的强/弱/禁三分类，明确每类场景对应工具

### Step 2：补充 Preference 的 volatility 字段

```typescript
// memory.ts
export type PreferenceVolatility = 'stable' | 'moderate' | 'volatile'

export interface Preference {
  // ... 已有字段 ...
  volatility?: PreferenceVolatility  // 不填默认 'moderate'
}
```

`prompt.ts: formatPreferencesCompact()` 中过滤掉 `volatility === 'volatile'` 的条目，不进 Tier 1。

### Step 3：SkillCard 去重强制检查

在 `save_skill_card` 工具实现中，写入前自动调用 skills 的语义检索，相似度超阈值时返回 `SIMILAR_EXISTS` 提示，要求 AI 追加而非新建：

```typescript
// memory-write.ts 改造思路（伪代码）
const similar = await vectorSearch(insight, existingSkillEmbeddings, threshold=0.82)
if (similar.length > 0) {
  return { content: `SIMILAR_EXISTS::${similar[0].id}::${similar[0].title}`, brief: '发现相似技能卡' }
  // 提示 AI：有相似卡，应追加 userNotes，不要新建
}
```

### Step 4：retrieval gate（检索门控）

在 `classify.ts` 或 `planner.ts` 入口，根据用户消息关键词判断需要预加载哪些 Tier 2 数据：

```typescript
// 伪代码，实际可在 planner prompt 中以规则形式实现
function inferRequiredMemory(userText: string): ToolDomain[] {
  if (/近况|最近状态|这几天|晨省/.test(userText)) return ['memory']  // get_daily_logs
  if (/誓约|目标|进度/.test(userText)) return ['vow']
  if (/之前总结|有没有洞察|学过/.test(userText)) return ['knowledge']
  if (/博客|文章|写过/.test(userText)) return ['cultivation', 'library']
  return []  // 默认不预加载记忆
}
```

---

## 九、核心结论

| 维度 | 当前状态 | 目标状态 |
|-----|---------|---------|
| 今日对话历史 | 固定取末 6 条 | 按 token 预算（~400 tokens）反向贪心，单条超 300 字截断 |
| 今日修炼摘要 | 单行，含活动类型×数量+streak+points | 维持，边界情况补全（断连、无活动） |
| 活跃誓约注入 | active 全量注入 | 上限 5 条，按 deadline 升序截断；paused 不注入 |
| L2 偏好注入 | conf≥0.35，top 8 | 加 volatility 过滤；每 category 最多 3 条 |
| Tier 2 检索触发 | 模型自由决策 | 强/弱/禁三类门控，意图信号→工具映射 |
| 检索结果注入 | 原样注入 tool result | packing：`[来源][日期] 摘要`，每类限条数 |
| SkillCard 写入 | 无去重，模型自愿判重 | 工具层强制前置相似度检查 |
| 偏好写入 | 部分覆盖，有 id 匹配逻辑 | 完善 volatility 分层；观察积累走离线 extractor |
| Vow 状态转移 | active→其他已实现 | paused 状态语义明确（不追踪，但可恢复） |

---

## 十、v3 完整重构计划（2026-04-22）

> 目标：把当前“可工作的记忆 MVP”升级为长期稳定的记忆系统。核心不是继续增加记忆类型，而是治理三件事：**上下文预算、检索格式、写入质量**。

### 10.1 重构目标

- **上下文可控**：每轮 prompt 有明确预算，系统规则、今日历史、页面上下文、记忆召回都不能无限膨胀。
- **记忆可信**：长期记忆必须有来源、证据、置信度、更新时间、生命周期。
- **检索稳定**：所有 Tier 2 检索结果统一 packing，模型看到的是结构化证据，不是各工具任意返回文本。
- **写入克制**：自动提炼先进入候选区；明确授权或证据足够后才晋升长期记忆。
- **行为可解释**：每次为什么召回某段记忆、为什么写入某条记忆，都能追踪。
- **数据可迁移**：保留 `content/spirit/*` 现有 JSON 数据，通过迁移层补元信息，不做破坏式重写。

### 10.2 目标架构

```
Spirit Memory v3

1. Memory Store
   读写、迁移、原子保存、索引元数据

2. Memory Schema
   统一所有记忆实体类型、生命周期、证据字段

3. Memory Ingestion
   把对话、日志、网页、技能洞察、偏好观察转成候选记忆

4. Memory Retrieval
   根据用户意图召回记忆，做 rerank 和 packing

5. Context Builder
   根据预算组装 System Prompt + 今日历史 + Memory Pack

6. Memory Governance
   候选审核、置信度更新、冲突处理、衰减、归档
```

建议目录结构：

```text
src/lib/spirit/memory/
  schema.ts
  store.ts
  paths.ts
  time.ts
  migrate.ts

  context/
    build-context.ts
    pack-history.ts
    pack-tier1.ts
    budgets.ts

  retrieval/
    intent.ts
    retrieve.ts
    pack.ts
    rank.ts

  ingestion/
    summarize-session.ts
    extract-preferences.ts
    extract-skills.ts
    extract-candidates.ts

  governance/
    candidates.ts
    promote.ts
    decay.ts
    conflict.ts

  tools/
    read.ts
    write.ts
    search.ts
```

当前阶段不强行一次迁移目录；先在现有 `src/lib/spirit/` 下落关键能力，稳定后再拆目录。

### 10.3 统一记忆基础字段

长期记忆实体应逐步补齐基础字段：

```typescript
interface MemoryBase {
  id: string
  type: MemoryType
  createdAt: string
  updatedAt: string
  source: MemorySource
  confidence: number
  status: 'active' | 'candidate' | 'archived' | 'retired'
  evidence: EvidenceRef[]
  tags: string[]
}

interface EvidenceRef {
  type: 'conversation' | 'daily_log' | 'manual' | 'web' | 'skill' | 'note'
  refId: string
  date?: string
  quote?: string
  weight?: number
}
```

现有 `DailyLog` / `Vow` 属于业务事实数据，不强制改成 `MemoryBase`；进入检索上下文时包装成 `MemoryPackItem`。

### 10.4 Context Builder 设计

替代当前 `buildSystemPrompt()` 直接拼字符串的模式，目标接口：

```typescript
interface ContextBuildInput {
  userText: string
  currentMessages: Message[]
  pageContext?: PageContext
  budget: ContextBudget
}

interface BuiltContext {
  systemPrompt: string
  prependedMessages: BaseMessage[]
  memoryPack: MemoryPackItem[]
  diagnostics: ContextDiagnostics
}
```

默认预算：

```typescript
const DEFAULT_CONTEXT_BUDGET = {
  systemRules: 350,
  tier1Snapshot: 500,
  todayHistory: 500,
  memoryPack: 1200,
  pageContext: 1000,
}
```

Tier 1 只保留：

- 身份与最短行为规则
- 当前时间
- 今日修炼摘要
- 活跃誓约 compact
- Top preferences
- Persona phase/issues
- 近期摘要 3-5 条

工具清单不应重复塞进 system prompt，工具能力由 tool schema 负责。

### 10.5 今日历史 Packing

替代固定 `slice(-6)`：

```typescript
packTodayHistory(messages, {
  budgetChars: 1800,
  minRecent: 4,
  maxMessages: 10,
  maxSingleChars: 500,
  skipToolLikeAssistantMessages: true,
})
```

规则：

- 最近 4 条强保留。
- 再从后往前追加，直到预算耗尽。
- 单条过长截断。
- assistant 的工具过程、权限确认过程、空响应不进上下文，只保留最终回答。
- 若前端已携带同一批历史，不重复 prepend。

### 10.6 Memory Retrieval Gate

从“提示模型去查”升级为“程序先判断 intent，强触发可预取”：

```typescript
type MemoryIntent =
  | 'recent_status'
  | 'weekly_pattern'
  | 'vow_progress'
  | 'skill_lookup'
  | 'conversation_lookup'
  | 'blog_lookup'
  | 'note_lookup'
  | 'none'
```

目标接口：

```typescript
interface MemoryIntentResult {
  intents: MemoryIntent[]
  strength: 'strong' | 'weak' | 'none'
  queries: string[]
  requiredTools: string[]
}
```

强触发示例：

- `recent_status` → `get_daily_logs(7)`
- `vow_progress` → `vow_summary()`
- `skill_lookup` → `search_skills(query)`
- `conversation_lookup` → `search_conversations(query/date)`

第一阶段仍可保留 system hint；第二阶段改为服务端预取 Memory Pack。

### 10.7 Memory Pack 统一格式

所有 Tier 2 检索结果统一包装：

```typescript
interface MemoryPackItem {
  type: 'daily_log' | 'weekly_pattern' | 'skill' | 'conversation' | 'note' | 'vow' | 'library' | 'blog'
  id: string
  date?: string
  title?: string
  summary: string
  source?: string
  score?: number
  confidence?: number
}
```

注入模型时统一格式：

```text
【相关记忆】
[daily_log][2026-04-20] 铸剑×2 +160修为，连续第 8 日
[skill][2026-04-18][0.83] Agent 工具权限应绑定 tool+payload hash，避免令牌重放
[conversation][2026-04-15] 讨论过 LangGraph 并行节点，结论是 Send() 更适合 fan-out
```

### 10.8 写入治理：候选记忆层

自动提炼不要直接污染长期记忆。分两类：

- **Explicit Write**：用户明确说“记住/以后/帮我记一下”，可以直接写。
- **Candidate Write**：模型观察到的偏好、人格、技能洞察，先写候选区。

候选文件：

```text
content/spirit/candidates/YYYY-MM-DD.json
```

候选结构：

```typescript
interface MemoryCandidate {
  id: string
  proposedType: 'preference' | 'skill' | 'persona' | 'note'
  payload: unknown
  reason: string
  evidence: EvidenceRef[]
  confidence: number
  status: 'pending' | 'promoted' | 'ignored' | 'merged'
  createdAt: string
}
```

晋升规则：

- 用户明确授权：直接 promote。
- 同类候选跨日出现 ≥2 次：promote。
- 与已有偏好同 key：更新 evidence/confidence，不新建。
- 低置信度候选保留 14 天后自动 ignore。
- 用户否定则 retire 或降低 confidence。

### 10.9 分阶段落地路线

#### Phase 1：Context Builder

- [待做] 拆 `buildSystemPrompt()` 为规则区和 Tier 1 快照区。
- [已完成] 实现今日历史预算 packing，替代固定末 6 条。
- [已完成] 今日历史改为“旧消息压缩摘录 + 最近原文”，硬截断仅作为单条超长兜底。
- [已完成] 添加 context diagnostics，方便观察每轮注入量。

#### Phase 2：Memory Pack

- [已完成] 引入 `MemoryPackItem` 与 `formatMemoryPack()`。
- [已完成] 统一 `get_daily_logs` / `get_weekly_patterns` / `get_skill_cards` / `search_notes` / `search_skills` / `search_conversations` 的模型注入格式。
- [已完成] 限制每类结果数量和单条长度。
- [已完成] SkillCard 注入从“一句话摘要”升级为能力卡摘要，包含可执行用法，避免退化成文档总结。
- [待做] 将 `vow_summary` / `list_vows` / `search_blog_posts` / `search_library` 也迁移到 Memory Pack 或对应 Pack 格式。

#### Phase 3：Retrieval Gate

- [已完成] 实现 `inferMemoryIntent()`，覆盖 recent_status / weekly_pattern / vow_progress / skill_lookup / conversation_lookup / note_lookup。
- [已完成] 强触发问题服务端直接预取 Memory Pack，并注入聊天上下文。
- [已完成] 保留工具调用作为补充，而不是唯一入口。
- [待做] 将对话/技能预取从轻量本地关键词匹配升级为可控 hybrid search，并加超时预算。

#### Phase 4：Candidate Memory

- [已完成] 新增候选记忆文件 `content/spirit/candidates/YYYY-MM-DD.json`。
- [已完成] 新增候选记忆 API：`GET /api/spirit/candidates` 与 `POST /api/spirit/candidates`。
- [已完成] 自动偏好/技能提炼先入候选，不再直接污染长期记忆。
- [已完成] 自动技能提炼从“完整 Markdown 文档”改为“可调用能力卡”：适用场景 / 操作步骤 / 检查清单 / 反例 / 证据。
- [已完成] 支持 preference / skill 候选的 promote，支持 ignore / merge 状态标记。
- [待做] persona 自动提炼接入候选层。
- [待做] 候选跨日重复证据自动晋升策略。

#### Phase 5：Governance + Migration

- 增加衰减、冲突、归档。
- 完善 Vow 状态机。
- 旧数据补 `source/evidence/status` 元信息。
- 迁移前写入 `content/spirit/backups/YYYY-MM-DD-HHmm/`。

### 10.10 当前优先级判断

优先改：

1. Context Builder 与今日历史 packing。
2. Memory Pack 统一格式。
3. Candidate Memory 写入治理。

暂缓：

1. 换 SQLite 或外部向量库。
2. 大规模目录迁移。
3. 复杂 UI 审核面板。

当前最大风险不是 JSON 存储，而是上下文和记忆写入缺乏足够治理。先把“哪些记忆进上下文、为什么进、怎么压缩、怎么写入”变成确定性流程，系统质量会明显提升。
