# 架构文档

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     浏览器 / 客户端                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  首页     │  │  博客     │  │ GitHub   │  │LeetCode│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│                    ┌──────────────────┐                  │
│                    │  SpiritWidget    │  ← 器灵对话组件   │
│                    └──────────────────┘                  │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────▼─────────────────────────────┐
│                   Next.js App Router                     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │               API Routes                         │    │
│  │  /api/spirit/chat   /api/spirit/context          │    │
│  │  /api/spirit/session  /api/spirit/mcp            │    │
│  │  /api/spirit/approve  /api/spirit/sync           │    │
│  │  /api/spirit/vows  /api/spirit/skills            │    │
│  │  /api/spirit/preferences                         │    │
│  │  /api/sync  /api/webhooks/{github,notion}        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Blog Adapter │  │GitHub Adapter│  │LeetCode      │   │
│  │ (Notion/MDX) │  │  (GraphQL)   │  │Adapter       │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │             Spirit AI (LangGraph)                │    │
│  │  classify → [direct skip] | Planner              │    │
│  │  → [Direct|Sequential|Parallel]                  │    │
│  │  Tools: shell, files, web, library, data, memory │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 模块说明

### 1. 数据适配层 `src/lib/adapters/`

统一不同数据源的访问接口，切换数据源只需修改 `codelife.config.ts`。

```
adapters/
├── blog/
│   ├── types.ts          BlogPost, Category 等类型定义
│   ├── index.ts          工厂函数，按 config.blog.provider 返回适配器
│   ├── local-mdx.ts      读取 content/posts/*.md(x)，gray-matter + next-mdx-remote
│   ├── notion.ts         Notion Database API，notion-to-md 转换；字数持久缓存
│   └── ghost.ts          Ghost Content API
├── github/
│   ├── types.ts
│   ├── index.ts
│   └── graphql.ts        @octokit/graphql 查询 contribution graph
└── leetcode/
    ├── types.ts
    ├── index.ts
    ├── manual.ts         解析 content/leetcode.yaml（js-yaml）
    └── unofficial.ts     LeetCode GraphQL（需 Cookie）
```

**Notion Adapter 字数缓存**：

`getPosts()` 只拉一次 Notion 元数据（含 `last_edited_time`），字数从 `content/blog_wc_cache.json` 读取：
- 命中且 `lastEdited` 匹配 → 直接用缓存值
- 未命中或页面有更新 → 拉正文计算字数 → 写入缓存

首次运行或有新文章时并发拉取，之后零额外 Notion 请求。

---

### 2. 修为与境界 `src/lib/cultivation/`

修为计算规则在 `codelife.config.ts` 的 `cultivation` 字段中配置，改规则无需改代码。

---

### 3. 器灵 AI `src/lib/spirit/`

器灵是基于 LangGraph.js 构建的自适应多 Agent 系统。

#### 3.1 核心模块

| 文件 | 职责 |
|------|------|
| `protocol.ts` | SSE 事件类型定义（`SpiritEvent` 联合类型） |
| `registry.ts` | 工具注册表，`registerTool()` + 写操作权限门控 |
| `prompt.ts` | `buildSystemPrompt()` — 实时读取五层记忆，构建主控系统提示 |
| `memory.ts` | 五层记忆读写：DailyLog / WeeklyPattern / PersonaProfile / Vow / Conversation |
| `sync.ts` | `syncToday()` — 拉取数据生成 DailyLog；触发周期记忆生成 |
| `hybrid-search.ts` | 混合检索：BM25 (MiniSearch) + 语义向量 (embedding)，RRF 融合排名 |
| `shell-permissions.ts` | 三级权限状态机：令牌生成（createApprovalToken / createWriteToken）、消费（consumeToken / consumeWriteToken）、会话级批准状态 |
| `skill-extractor.ts` | 从对话中提炼技术洞察，写入技能卡 |
| `summarize.ts` | 对话内容摘要生成（用于 Tier 1 记忆注入） |
| `mcp-loader.ts` | MCP 服务初始化，按 config 启动 stdio/http transport，自动注册工具 |

#### 3.2 工具层 `spirit/tools/`

所有工具通过 `registerTool(definition, handler, opts)` 注册进全局 registry，LangGraph 层初始化时 wrap 成 `DynamicStructuredTool`。

工具按**域（domain）**分组，每次请求根据消息关键词决定加载哪些域，避免将不相关工具堆入上下文。

**域分配**

| 域 | 加载时机 | 工具数 |
|----|----------|--------|
| `cultivation` | 默认 | 4 |
| `memory` | 默认 | 5 |
| `vow` | 默认 | 5 |
| `knowledge` | 默认 | 6 |
| `meta` | 默认 | 2 |
| `web` | 消息含"搜索/查一下/最新"等关键词时 | 2 |
| `library` | 消息含"藏经阁/文档/收藏"等关键词时 | 3 |
| `system` | 消息含"命令/执行/文件/代码/shell"等关键词时 | 3 |

**cultivation 域**

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `read_leetcode_records` | `codelife.ts` | 读取刷题记录 |
| `read_cultivation_stats` | `codelife.ts` | 读取修为总览 |
| `search_blog_posts` | `codelife.ts` | 混合检索用户博客 |
| `search_conversations` | `codelife.ts` | 语义检索历史对话 |

**memory 域**

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `get_daily_logs` | `memory-read.ts` | 读取近 N 天 DailyLog |
| `get_weekly_patterns` | `memory-read.ts` | 读取周规律 |
| `get_skill_cards` | `memory-read.ts` | 读取技能卡（原始格式） |
| `update_persona_observation` | `memory-write.ts` | 更新人格观察（写） |

**vow 域**

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `list_vows` | `vow.ts` | 列举誓约 |
| `vow_summary` | `vow.ts` | 查看誓约详细进度（含各子目标数据） |
| `create_vow` | `vow.ts` | 创建誓约（需权限确认） |
| `update_vow` | `vow.ts` | 修改誓约 |
| `delete_vow` | `vow.ts` | 删除誓约（需权限确认） |

**knowledge 域**

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `write_note` | `memory-write.ts` | 写随手记 |
| `save_skill_card` | `memory-write.ts` | 保存技术洞察卡片（写） |
| `search_skills` | `skills.ts` | 全文检索技能卡 |
| `list_skills` | `skills.ts` | 列出所有技能卡（支持标签过滤） |
| `delete_skill` | `skills.ts` | 删除技能卡 |
| `list_preferences` | `preferences.ts` | 列出用户偏好（按置信度排序） |
| `save_preference` | `preferences.ts` | 保存/更新用户偏好 |

**meta 域**

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `install_mcp` | `mcp-install.ts` | 动态安装 MCP 服务器（当前进程有效） |
| `list_mcp_servers` | `mcp-install.ts` | 查看已载入 MCP 服务器及工具数 |

**web 域（按需）**

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `web_search` | `search.ts` | Tavily API 联网搜索 |
| `fetch_url` | `web.ts` | 抓取任意 URL 纯文本 |

**library 域（按需）**

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `collect_document` | `library.ts` | 收藏文章到藏经阁（需权限确认） |
| `search_library` | `library.ts` | 混合检索藏经阁 |
| `list_library` | `library.ts` | 按分类列举藏经阁 |

**system 域（按需）**

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `run_shell` | `shell.ts` | 执行 shell 命令，三级安全分类（safe/moderate/destructive） |
| `list_files` | `files.ts` | 列出目录结构（支持 glob 过滤） |
| `read_file` | `files.ts` | 读取文件内容（支持行号范围） |

新增工具：在 `spirit/tools/` 下新建文件，调用 `registerTool(definition, handler, { domain: '...' })`，在 `tools/index.ts` 中 import 触发注册。

#### 3.3 写操作权限门控

`registry.ts` 中工具可标记 `requiresApproval: true`，此时工具调用流程变为：

```
callTool(name, args)
  ├─ args 中无 approval_token
  │     → createWriteToken(name, summary) → 生成一次性令牌
  │     → 返回 "PERMISSION_REQUIRED::{token}::write::{摘要}::"
  │     → stream.ts 检测前缀 → 发送 permission_request SSE 事件
  │     → 前端渲染确认/拒绝弹窗
  │
  └─ args 中有 approval_token
        → consumeWriteToken(token, name) → 验证令牌（绑定工具名，一次性）
        → 验证通过 → 去掉 approval_token 参数 → 执行工具 handler
```

Shell 命令使用同一套令牌机制，但额外支持「本次会话允许」（`sessionAllowModerate`），中危命令在会话内不再弹窗。

#### 3.4 LangGraph 编排层 `spirit/langgraph/`

##### 快速分类器（classify.ts）

对话开始前先走纯规则分类器，命中则直接走 direct 策略，跳过 Planner LLM 调用：

```
classify(message)
  ├─ 简单问候 / 单工具查询 → direct（无 LLM 开销）
  └─ 其他 → null（交给 Planner 决策）
```

##### 状态（state.ts）

```typescript
GraphState = {
  messages:       BaseMessage[]              // append-only，消息历史
  strategy:       'direct'|'sequential'|'parallel'|null
  next:           string                     // sequential: supervisor 路由目标
  subtasks:       SubTask[]                  // parallel: 子任务列表
  subtaskResults: Record<string, string>     // parallel: 各 executor 结果（并行合并）
}
```

##### 执行策略与节点

```
classify（纯规则，可跳过 Planner）
    │
    ▼
Planner（LLM 分析任务 → 决策 strategy）
    │
    ├─ direct    ─────────────────────────────► qingxiao ──► __end__
    │
    ├─ sequential ──► supervisor
    │                    │
    │              ┌─────┼──────────────┐
    │              ▼     ▼              ▼
    │          qingxiao  search_agent  code_agent / planner_agent
    │              └─────┴──────────────┘
    │                    │ (loop)
    │                supervisor ──FINISH──► __end__
    │
    └─ parallel ──► Send([executor×N])
                        │
              ┌─────────┼──────────┐
              ▼         ▼          ▼    （并行，LangGraph Pregel 自动同步）
          executor   executor   executor
              └─────────┴──────────┘
                        │  subtaskResults 合并
                    synthesizer ──► __end__
```

##### Planner 决策规则

```
direct（强默认）：
- qingxiao 在 ReAct 循环内可完成搜索+分析、执行+解释等多步骤
- 不确定时永远选 direct

sequential（同时满足两条）：
- 后一步输入明确依赖前一步的具体输出
- 前一步必须由专项 Agent 完成（qingxiao 自己做不够）

parallel（同时满足两条）：
- 有 2+ 个明确相互独立的子任务
- 每个子任务各需要不同专项 Agent
```

##### 节点职责

| 节点 | 文件 | 说明 |
|------|------|------|
| `planner` | `nodes/planner.ts` | `withStructuredOutput` 决策 strategy + subtasks，解析失败时优雅降级为 direct |
| `supervisor` | `nodes/supervisor.ts` | Sequential 调度，决策 `next` 字段 |
| `executor` | `nodes/executor.ts` | Parallel 执行单元，由 `Send` API 并发触发 |
| `synthesizer` | `nodes/synthesizer.ts` | 合并并行结果为统一回答 |
| `qingxiao` | `agents.ts` | `createReactAgent`，按请求域加载工具，主控 |
| `search_agent` | `agents.ts` | `createReactAgent`，仅 web_search + fetch_url |
| `code_agent` | `agents.ts` | `createReactAgent`，算法相关工具 |
| `planner_agent` | `agents.ts` | `createReactAgent`，学习规划工具（list_preferences 等） |

Agent ID / 展示名由 `langgraph/agent-config.ts` 的 `AGENT_DEFS` 数组集中定义，`AgentId` 类型、`AGENT_IDS` 元组、`AGENT_DISPLAY` 映射均从该数组派生，不在其他文件重复声明。

##### 图编译与域注入

每次 `/api/spirit/chat` 请求都会调用 `getQingxiaoDomains(userMessage)` 得到本轮域列表，并传入 `buildFullGraph(domains)` 重新编译整张图（非模块级缓存）。这样工具集精确匹配消息意图。仅 debug 用的 direct 模式图（`buildDirectGraph`）按 agentId 缓存。

```typescript
// tools.ts
const QINGXIAO_DEFAULT_DOMAINS = ['cultivation', 'memory', 'vow', 'knowledge', 'meta']

// 按消息关键词追加可选域
function inferExtraDomains(msg: string): ToolDomain[]
function getQingxiaoDomains(msg?: string): ToolDomain[]
```

##### SSE 流（stream.ts）

`graph.streamEvents()` → `translateToSpiritEvents()` → 推送 `SpiritEvent`。

- `ThinkFilter` 状态机：分离 `<think>...</think>` 块，分别作为 `thinking` 事件和 `text` 事件推送
- `describeToolInput()`：将工具入参转换为人类可读摘要，显示在步骤 UI 中
- `extractBrief()`：解析工具输出中的 `BRIEF::{内容}\n` 前缀
- `PERMISSION_REQUIRED::` 前缀检测：发送 `permission_request` SSE 事件而非普通文本
- `on_tool_end`：解析 web_search / fetch_url 输出中的链接，附加到 `tool_done.links`

#### 3.5 SSE 协议（protocol.ts）

客户端与服务端共享的事件类型：

```typescript
type SpiritEvent =
  | { type: 'text';        chunk: string }
  | { type: 'thinking';    chunk: string }                         // <think> 块内容
  | { type: 'tool_start';  name: string; display: string; desc?: string }
  | { type: 'tool_done';   name: string; brief?: string; links?: { title: string; url: string }[] }
  | { type: 'cards';       entries: LibraryCard[] }
  | { type: 'agent_start'; agent: string; display: string }
  | { type: 'agent_end';   agent: string }
  | { type: 'strategy';    mode: 'direct'|'sequential'|'parallel'; taskCount?: number }
  | { type: 'task_start';  taskId: string; agent: string; display: string; desc: string }
  | { type: 'task_done';   taskId: string; agent: string }
  | { type: 'permission_request'; token: string; command: string; workdir: string; level: 'moderate'|'destructive'|'write' }
  | { type: 'error';       message: string }
  | { type: 'done' }
```

#### 3.6 五层记忆系统（memory.ts + prompt.ts + sync.ts）

五层记忆，全部存储于 `content/spirit/`，构建 System Prompt 时实时读取：

| 层级 | 文件位置 | 更新时机 | Prompt 角色 |
|------|----------|----------|------------|
| **DailyLog** | `logs/{date}.json` | 每次对话自动触发（今日无日志时执行） | Tier 1 今日快照 |
| **WeeklyPattern** | `patterns/{year}-W{n}.json` | 每周一 sync 后 LLM 分析生成 | Tier 2 按需拉取 |
| **PersonaProfile** | `persona.json` | sync 后检查，超 7 天则 LLM 重新分析 | Tier 1 人格/惯性 |
| **Vow** | `vows.json` | 用户通过工具创建/完成 | Tier 1 誓约进度 |
| **Conversation** | `conversations/{date}.json` + `summaries/` | 每次对话后前端 POST 保存；摘要按需生成 | Tier 1 近期摘要（近5天） |

**Tier 1 / Tier 2 分层**：

```
Tier 1（永远注入，~800 tokens）：
  身份规则 + 时间 + 人格 + 今日摘要 + 誓约 + 近5天对话摘要

Tier 2（工具按需拉取）：
  get_daily_logs / get_weekly_patterns / get_skill_cards / search_conversations
```

**同步触发流程**：

```
POST /api/spirit/chat
  → syncToday()（今日无 DailyLog 时）
  → buildSystemPrompt()
  → LangGraph

GET /api/sync?source=blog（手动/cron/webhook）
  → revalidateTag('blog') → 下次访问重新拉 Notion
```

#### 3.7 前端组件（SpiritWidget 及拆分模块）

原 `SpiritWidget.tsx` 单文件已拆分为以下模块：

| 文件 | 职责 |
|------|------|
| `components/spirit/types.ts` | 共享类型：`ExecutionStep`、`PermissionRequest`、`Message`、`MCPInfo`、`SlashCommand`、`SLASH_COMMANDS` |
| `components/spirit/MessageItem.tsx` | 单条消息渲染（memo 化，防止输入时重渲历史消息） |
| `components/spirit/useSpiritChat.ts` | 聊天状态管理 Hook（SSE 消费、步骤追踪、权限确认逻辑） |
| `components/spirit/SpiritWidget.tsx` | 顶层容器，布局 + 拖拽 + 斜杠命令 |

**消息结构**（定义于 `components/spirit/types.ts`）：

```typescript
interface Message {
  role:               'user' | 'assistant'
  content:            string
  thinking?:          string          // <think> 内容，可折叠显示
  steps?:             ExecutionStep[] // 工具执行步骤（含 links）
  permissionRequest?: PermissionRequest  // 权限确认弹窗状态
  cards?:             LibraryCard[]   // 藏经阁结构化结果
}

interface ExecutionStep {
  display:  string
  desc?:    string   // 入参摘要
  brief?:   string   // 结果摘要
  links?:   { title: string; url: string }[]
  done:     boolean
}

interface PermissionRequest {
  token:    string
  command:  string
  level:    'moderate' | 'destructive' | 'write'
  resolved: boolean
}
```

**权限确认流程**：

```
permission_request SSE 事件
  → 更新最后一条消息的 permissionRequest 字段
  → MessageItem 渲染确认弹窗
  → 用户点击 → handlePermission(decision)
      → POST /api/spirit/approve { token, decision }
      → 服务端 consumeToken / consumeWriteToken
      → 返回 approvalToken（若批准）
      → 前端追加 user 消息 + approvalToken → 触发新轮 send()
      → AI 以 approval_token 参数重新调用工具 → 实际执行
```

---

### 4. API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/spirit/chat` | POST | LangGraph Agent 主入口，返回 SSE 流；自动触发当日 sync |
| `/api/spirit/approve` | POST | 权限令牌审批（shell / 写操作确认），返回 approvalToken |
| `/api/spirit/context` | GET `?path=` | 按当前页面路径返回结构化上下文文本 |
| `/api/spirit/session` | GET / POST | 读取 / 保存当日对话记录 |
| `/api/spirit/mcp` | GET | 返回已加载 MCP 服务器 + 全部工具（含内置） |
| `/api/spirit/mcp` | POST | 动态装载 MCP 包（需 `allowDynamicInstall: true`） |
| `/api/spirit/vows` | GET / POST / PATCH / DELETE | 誓约 CRUD |
| `/api/spirit/skills` | GET / POST / PATCH / DELETE | 技能卡 CRUD |
| `/api/spirit/preferences` | GET / POST / PATCH / DELETE | 用户偏好 CRUD |
| `/api/spirit/sync` | POST | 触发数据同步 + 周期记忆生成 |
| `/api/sync` | GET | 按需重置 ISR 缓存（`?source=blog\|github\|leetcode\|all`） |
| `/api/webhooks/github` | POST | GitHub Push 事件 → 触发 commit 同步 |
| `/api/webhooks/notion` | POST | Notion 变更 → 触发博客同步 |

---

### 5. 数据流

**器灵对话**：

```
用户输入
  → SpiritWidget.send()
  → POST /api/spirit/chat { messages }
  → classify() → 简单查询直接 direct，其他走 Planner
  → getCompiledGraph()
  → graph.streamEvents()
  → translateToSpiritEvents()
    ├─ thinking 事件（<think> 块）
    ├─ tool_start / tool_done（含 brief + links）
    ├─ permission_request（写操作/高危 shell）
    └─ text / done
  → SSE 推送 → SpiritWidget 消费，更新 UI
```

**权限确认**：

```
permission_request 事件
  → 前端弹窗 → 用户确认
  → POST /api/spirit/approve { token, decision }
  → 返回 approvalToken
  → 新轮对话携带 approvalToken → 工具实际执行
```

---

## 扩展指南

### 新增博客数据源

1. 在 `src/lib/adapters/blog/` 下新建 `{name}.ts`，实现 `BlogAdapter` 接口
2. 在 `index.ts` 的工厂函数中注册
3. 在 `codelife.config.ts` 的 `blog.provider` 中使用新名字

### 新增器灵工具

```typescript
// src/lib/spirit/tools/my-tool.ts
import { registerTool } from '../registry'

registerTool(
  { name: 'my_tool', description: '...', parameters: { ... } },
  async (args) => { return { content: '...', brief: '...' } },
  { displayName: '我的工具', domain: 'knowledge' }  // 必须指定 domain
)
```

在 `tools/index.ts` 中 import 即可。

### 新增写操作权限门控

```typescript
registerTool(definition, handler, {
  displayName:     '操作名',
  requiresApproval: true,
  approvalSummary:  (args) => `操作描述：${args.title}`,
})
```

`approval_token` 参数会自动注入到工具 schema，无需手动添加。

### 接入 MCP 服务

在 `codelife.config.ts` 的 `spirit.mcpServers` 中声明即可，重启后自动加载。

### 新增专项 Agent

1. 在 `langgraph/agent-config.ts` 的 `AGENT_DEFS` 数组中新增一条（id + displayName）；`AgentId`、`AGENT_IDS`、`AGENT_DISPLAY` 自动派生
2. `tools.ts` 中为新 Agent 指定可见工具（`agents` 过滤字段）
3. `agents.ts` 中新建 `createXxxAgent()` 函数，加入 `getAgentById` 的 switch
4. `graph.ts` 中加入节点和路由
5. 更新 `nodes/planner.ts` 和 `nodes/supervisor.ts` 的 schema + 提示

---

## 防死循环机制

器灵 Agent 的执行轮数受双重保护：

1. **recursionLimit**（LangGraph 层）：`maxToolRounds × (并行任务数 + 2)`
2. **maxToolRounds**（config 层）：`codelife.config.ts` 中配置，默认 6

---

## 性能优化

- **博客字数缓存**：`content/blog_wc_cache.json` 按 pageId + lastEdited 缓存字数，首次后无需重复拉正文
- **ISR**：GitHub / LeetCode 数据按配置的 `revalidate` 周期缓存
- **按请求编译图**：每次请求调用 `buildFullGraph(domains)` 重新编译，工具集与消息意图精确匹配；direct 模式图按 agentId 缓存（调试用）
- **Agent 缓存**：`getAgentById()` 懒加载单例缓存，executor 并行时多个子任务可复用同一 Agent 实例
- **快速分类器**：`classify.ts` 纯规则匹配，命中时跳过 Planner LLM 调用（节省 ~1 次 RTT）
- **域过滤**：默认仅注入 22 个工具（cultivation/memory/vow/knowledge/meta），web/library/system 按需追加，减少上下文长度
- **博客/藏经阁混合检索**：BM25 + embedding 预索引，搜索不阻塞在线 embed 计算
- **React.memo**：`MessageItem` memo 化，防止输入时重渲染历史消息
- **CSS 变量 + 直接 DOM 操作**：面板拖拽绕开 React 渲染循环，实现实时响应
