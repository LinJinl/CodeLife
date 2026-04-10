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
│  │  /api/spirit/vows   /api/spirit/sync             │    │
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
│  │  Planner → [Direct|Sequential|Parallel]          │    │
│  │  Tools: web_search, fetch_url, library, data     │    │
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
│   ├── notion.ts         Notion Database API，notion-to-md 转换
│   └── ghost.ts          Ghost Content API
├── github/
│   ├── types.ts          Repo, Commit, Stats 类型
│   ├── index.ts
│   └── graphql.ts        @octokit/graphql 查询 contribution graph
└── leetcode/
    ├── types.ts          Problem, Submission 类型
    ├── index.ts
    ├── manual.ts         解析 content/leetcode.yaml（js-yaml）
    └── unofficial.ts     LeetCode GraphQL（需 Cookie）
```

**关键接口**：

```typescript
// 所有博客适配器实现此接口
interface BlogAdapter {
  getPosts(): Promise<BlogPost[]>
  getPost(slug: string): Promise<BlogPost | null>
}
```

ISR（增量静态再生成）缓存时间在 config 中配置：`github.revalidate`、`leetcode.revalidate`。

---

### 2. 修为与境界 `src/lib/cultivation/`

```
cultivation/
└── realm.ts    calcRealm(points) → RealmInfo
                calcPoints(activities) → number
```

修为计算规则在 `codelife.config.ts` 的 `cultivation` 字段中配置，改规则无需改代码。

---

### 3. 器灵 AI `src/lib/spirit/`

器灵是基于 LangGraph.js 构建的自适应多 Agent 系统。

#### 3.1 核心模块

| 文件 | 职责 |
|------|------|
| `protocol.ts` | SSE 事件类型定义（`SpiritEvent` 联合类型） |
| `registry.ts` | 工具注册表，`registerTool()` / `registerMCPAdapter()` |
| `prompt.ts` | `buildSystemPrompt()` — 实时读取五层记忆，构建主控系统提示 |
| `memory.ts` | 五层记忆读写：DailyLog / WeeklyPattern / PersonaProfile / Vow / Conversation |
| `sync.ts` | `syncToday()` — 从适配器拉取数据，生成当日 DailyLog；触发周期记忆生成 |
| `hybrid-search.ts` | 混合检索：关键词（MiniSearch）+ 语义（embedding），用于博客 / 藏经阁搜索 |
| `mcp-loader.ts` | MCP 服务初始化，按 config 启动 stdio / http transport，自动注册工具 |

#### 3.2 工具层 `spirit/tools/`

所有工具通过 `registerTool()` 注册进全局 registry，LangGraph 层在初始化时 wrap 成 LangChain `DynamicStructuredTool`。

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `web_search` | `search.ts` | Tavily API 联网搜索 |
| `fetch_url` | `web.ts` | 抓取任意 URL 纯文本 |
| `search_library` | `library.ts` | 检索藏经阁 |
| `list_library` | `library.ts` | 按分类列举藏经阁 |
| `collect_document` | `library.ts` | 收藏文章（自动抓取+分析） |
| `read_user_blogs` | `codelife.ts` | 读取用户博客列表 |
| `read_leetcode_records` | `codelife.ts` | 读取刷题记录 |
| `read_cultivation_stats` | `codelife.ts` | 读取修为总览 |

新增工具：在 `spirit/tools/` 下新建文件，调用 `registerTool()`，在 `tools/index.ts` 中 import 触发注册。

接入 MCP 服务：实现 `MCPAdapter` 接口，调用 `registerMCPAdapter()`，工具名自动加命名空间前缀。

#### 3.3 LangGraph 编排层 `spirit/langgraph/`

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
Planner（LLM 分析任务 → 决策 strategy）
    │
    ├─ direct    ─────────────────────────────► qingxiao ──► __end__
    │
    ├─ sequential ──► supervisor
    │                    │
    │              ┌─────┼──────────────┐
    │              ▼     ▼              ▼
    │          qingxiao  search_agent  code_agent / planner_agent
    │              │     │              │
    │              └─────┴──────────────┘
    │                    │ (loop)
    │                supervisor ──FINISH──► __end__
    │
    └─ parallel ──► Send([executor×N])
                        │
              ┌─────────┼──────────┐
              ▼         ▼          ▼       （并行，LangGraph Pregel 自动同步）
          executor   executor   executor
              │         │          │
              └─────────┴──────────┘
                        │  subtaskResults 合并
                    synthesizer ──► __end__
```

##### 节点职责

| 节点 | 文件 | 说明 |
|------|------|------|
| `planner` | `nodes/planner.ts` | `withStructuredOutput` 决策 strategy + subtasks |
| `supervisor` | `nodes/supervisor.ts` | Sequential 调度，决策 `next` 字段 |
| `executor` | `nodes/executor.ts` | Parallel 执行单元，由 `Send` API 并发触发 |
| `synthesizer` | `nodes/synthesizer.ts` | 合并并行结果为统一回答 |
| `qingxiao` | `agents.ts` | `createReactAgent`，全量工具，主控 |
| `search_agent` | `agents.ts` | `createReactAgent`，仅 web_search + fetch_url |
| `code_agent` | `agents.ts` | `createReactAgent`，算法相关工具 |
| `planner_agent` | `agents.ts` | `createReactAgent`，学习规划工具 |

##### 工具 Wrap（tools.ts）

JSON Schema → Zod → `DynamicStructuredTool`。`brief` 通过 `BRIEF::{内容}\n` 前缀约定携带，`stream.ts` 解析后去掉前缀。

工具集按 Agent 分组：

```typescript
TOOL_SETS = {
  search_agent:  ['web_search', 'fetch_url'],
  code_agent:    ['read_leetcode_records', 'read_user_blogs', 'search_library', 'list_library'],
  planner_agent: ['read_cultivation_stats', 'read_user_blogs', 'read_leetcode_records', 'search_library'],
  qingxiao:      '*',  // 全部工具
}
```

##### SSE 流（stream.ts）

`graph.streamEvents()` → `translateToSpiritEvents()` → 推送 `SpiritEvent`。

过滤规则：
- `planner` / `supervisor` 节点：使用 `withStructuredOutput`，token 流不对外可见
- `<think>...</think>` 块：通过 `ThinkFilter` 状态机过滤，支持 DeepSeek / QwQ 等显式输出推理链的模型

---

#### 3.4 Agent 间通信（A2A）

通信方式是**状态中介（state-mediated）**，通过 `GraphState` 共享，而非点对点消息传递：

| 策略 | 通信方式 |
|------|----------|
| **Direct** | 单 Agent，无 A2A |
| **Sequential** | Append-only `messages` 数组：每个 Agent 执行后将回答追加进 `messages`，Supervisor 读取全量历史决策下一步；后继 Agent 天然能看到前序 Agent 的全部输出 |
| **Parallel** | 各 Executor 相互隔离，各自持有原始 `messages` 副本；结果写入 `subtaskResults[taskId]`，Synthesizer 读取所有结果整合为最终回答 |

Sequential 模式示意：
```
messages = [用户消息]
  → search_agent 执行 → messages = [用户消息, 搜索结果]
  → planner_agent 执行（看到搜索结果）→ messages = [用户消息, 搜索结果, 学习计划]
  → supervisor: FINISH
```

---

#### 3.5 SSE 协议（protocol.ts）

客户端与服务端共享的事件类型：

```typescript
type SpiritEvent =
  | { type: 'text';        chunk: string }
  | { type: 'tool_start';  name: string; display: string }
  | { type: 'tool_done';   name: string; brief?: string }
  | { type: 'cards';       entries: LibraryCard[] }        // 藏经阁结构化结果
  | { type: 'agent_start'; agent: string; display: string }
  | { type: 'agent_end';   agent: string }
  | { type: 'strategy';    mode: 'direct'|'sequential'|'parallel'; taskCount?: number }
  | { type: 'task_start';  taskId: string; agent: string; display: string; desc: string }
  | { type: 'task_done';   taskId: string; agent: string }
  | { type: 'error';       message: string }
  | { type: 'done' }
```

#### 3.5 五层记忆系统（memory.ts + prompt.ts + sync.ts）

五层记忆，全部存储于 `content/spirit/`，构建 System Prompt 时实时读取：

| 层级 | 文件位置 | 更新时机 | 注入 Prompt |
|------|----------|----------|-------------|
| **DailyLog** | `logs/{date}.json` | 每次 `POST /api/spirit/chat` 自动触发（今日无日志时执行） | 近 14 日每日活动摘要 |
| **WeeklyPattern** | `patterns/{year}-W{n}.json` | 每周一 `POST /api/spirit/sync` 后 LLM 分析生成，幂等 | 近 4 周叙事 + 隐患标记 |
| **PersonaProfile** | `persona.json` | `POST /api/spirit/sync` 后检查，超 7 天则 LLM 重新分析 | 特征/惯性/当前阶段 |
| **Vow** | `vows.json` | 用户通过对话工具创建/完成 | 活跃誓约完成状态 |
| **Conversation** | `conversations/{date}.json` | 每次对话结束后前端 POST 保存 | 近 2 日对话摘要（最近 8 条/天，截断 280 字） |

**同步触发流程**：

```
POST /api/spirit/chat
  → 检查 getDailyLog(today) 是否存在
      → 不存在: syncToday()（同步拉取博客/LC数据，写入 DailyLog）
  → buildSystemPrompt()（动态读取所有层记忆）
  → 送入 LangGraph

POST /api/spirit/sync（可由 cron / webhook 触发）
  → syncToday()
  → shouldGenerateWeeklyPattern() → generateWeeklyPattern(llm)（周一触发）
  → shouldUpdatePersona() → updatePersona(llm)（>7 天触发）
  → invalidateAgentCache()（确保下次对话拿到最新 persona）
```

**System Prompt 注入顺序**：
```
角色定义 + 风格规范
当前时间
人格档案（persona.currentPhase + traits + issues）
近 4 周规律（WeeklyPattern narratives + flags）
近 14 日行为（DailyLog 逐日摘要）
当前誓约（Vow subGoals 完成进度）
近期对话记录（Conversation 最近 2 天，供连续话题参考）
对话原则 + 工具使用指导
```

**`messageModifier` 动态化**：`createQingxiaoAgent()` 使用函数形式而非静态 `SystemMessage`，确保即使 Agent 被缓存，每次调用仍读取最新记忆文件。

---

### 4. 前端组件 `src/components/`

| 组件 | 说明 |
|------|------|
| `SpiritWidget.tsx` | 器灵对话组件，含 SSE 消费、上下文管理、Markdown 渲染、并行任务进度 |
| `layout/Navigation.tsx` | 顶部导航，监听滚动切换背景，跟随器灵面板偏移 |
| `layout/WorldBackground.tsx` | 背景粒子/水墨特效 |

**SpiritWidget 的状态**：

| 状态 | 类型 | 说明 |
|------|------|------|
| `strategy` | `string \| null` | Planner 返回的策略（`direct/sequential/parallel`） |
| `taskList` | 数组 | 并行任务列表，含 id/display/desc/done |
| `activeAgent` | 对象 | Sequential 当前执行的专项 Agent |
| `toolSteps` | 数组 | 当前轮工具执行进度 |
| `contexts` | 数组 | 已注入的页面上下文（可叠加多个路径） |

**SpiritWidget 的面板宽度同步**：通过 CSS 变量 `--spirit-panel-w` 驱动，`body { padding-right: var(--spirit-panel-w) }` 实现内容自动左移，拖拽时直接写 DOM 变量绕开 React 渲染延迟。

---

### 5. API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/spirit/chat` | POST | LangGraph Agent 主入口，返回 SSE 流；自动触发当日 sync |
| `/api/spirit/context` | GET `?path=` | 按当前页面路径返回结构化上下文文本 |
| `/api/spirit/session` | GET / POST | 读取 / 保存当日对话记录 |
| `/api/spirit/mcp` | GET | 返回已加载 MCP 服务器 + 全部工具（含内置）|
| `/api/spirit/mcp` | POST | 动态装载 MCP 包（需 `allowDynamicInstall: true`）|
| `/api/spirit/tools` | GET | 兼容接口，返回工具列表 + MCP 适配器（同 mcp GET） |
| `/api/spirit/vows` | GET / POST / PATCH / DELETE | 誓约 CRUD（列表 / 创建 / 更新 / 删除） |
| `/api/spirit/sync` | POST | 触发数据同步 + 周期记忆生成（WeeklyPattern / PersonaProfile）|
| `/api/sync` | POST | 全量数据同步（触发所有适配器） |
| `/api/webhooks/github` | POST | GitHub Push 事件 → 触发 commit 同步 |
| `/api/webhooks/notion` | POST | Notion 变更 → 触发博客同步 |

---

### 6. 数据流

**页面加载**：
```
浏览器请求
  → Next.js ISR / 动态渲染
  → lib/data.ts 统一入口
  → 对应 Adapter 读取数据（本地/API）
  → 返回页面
```

**器灵对话**：
```
用户输入
  → SpiritWidget.send()
  → POST /api/spirit/chat { messages }
  → getCompiledGraph()          ← 模块级缓存，首次构建后复用
  → graph.streamEvents()
  → translateToSpiritEvents()   ← 过滤 planner/supervisor 节点文本
  → SSE 推送 SpiritEvent
  → SpiritWidget 消费，更新 UI
```

**数据同步**：
```
Webhook / 定时任务 / 手动触发
  → /api/spirit/sync
  → syncToday()
  → 各 Adapter 拉取当日数据
  → 写入 content/spirit/logs/{date}.json
  → 器灵下次对话时注入上下文
```

---

## 扩展指南

### 新增博客数据源

1. 在 `src/lib/adapters/blog/` 下新建 `{name}.ts`，实现 `BlogAdapter` 接口
2. 在 `src/lib/adapters/blog/index.ts` 的工厂函数中注册
3. 在 `codelife.config.ts` 的 `blog.provider` 中使用新 provider 名

### 新增器灵工具

1. 在 `src/lib/spirit/tools/` 下新建文件
2. 调用 `registerTool(definition, handler, opts)`
3. 在 `src/lib/spirit/tools/index.ts` 中 import

### 接入 MCP 服务

```typescript
import { registerMCPAdapter } from '@/lib/spirit/registry'

registerMCPAdapter({
  namespace: 'memory',
  name: 'Memory Server',
  listTools: async () => [...],
  callTool: async (name, args) => '...',
})
```

工具名自动加 `memory__` 前缀，如 `memory__search`。

### 新增专项 Agent

1. 在 `src/lib/spirit/langgraph/tools.ts` 的 `TOOL_SETS` 中定义工具集
2. 在 `src/lib/spirit/langgraph/agents.ts` 中新建 `createXxxAgent()` 函数，同步加入 `getAgentById` 的 switch 分支
3. 在 `src/lib/spirit/langgraph/graph.ts` 中加入节点和路由，清空 `_fullGraph` 缓存（模块重载时自动重建）
4. 在 `AGENT_DISPLAY` 中注册展示名
5. 更新 `nodes/planner.ts` 的 `plannerSchema.agentId` 枚举和系统提示，让 Planner 知道新 Agent 的能力
6. 更新 `nodes/supervisor.ts` 的 `supervisorSchema.next` 枚举和调度提示

---

## 防死循环机制

器灵 Agent 的执行轮数受双重保护：

1. **recursionLimit**（LangGraph 层）：`maxToolRounds × (并行任务数 + 2)`，超出后 LangGraph 抛出异常
2. **maxToolRounds**（config 层）：`codelife.config.ts` 中配置，默认 6，作为计算基数

---

## 性能优化

- **ISR**：GitHub / LeetCode 数据按配置的 `revalidate` 周期缓存，避免频繁 API 请求
- **图缓存**：`getCompiledGraph()` 模块级缓存，编译后的 StateGraph 在同进程内所有请求复用
- **Agent 缓存**：`getAgentById()` 懒加载单例缓存，executor 并行时多个子任务可复用同一 Agent 实例
- **React.memo**：`SpiritWidget` 中的 `MessageItem` 组件 memo 化，防止输入时重渲染历史消息
- **CSS 变量 + 直接 DOM 操作**：面板拖拽时绕开 React 渲染循环，实现实时响应
- **工具并行执行**：`callToolsParallel()` 并发调用多个工具，减少等待时间
- **LangGraph 并行模式**：Parallel 策略下 N 个 executor 并发运行，Pregel 引擎自动同步
