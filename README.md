# 道途 · CodeLife

> 一个修仙风格的个人学习成长网站。将写作、刷题、开源贡献转化为修为，追踪境界提升，由 AI 器灵陪伴修炼。

---

## 功能特性

- **修为体系** — 每篇博文、每道算法题、每次 commit 都产生修为，驱动境界升级
- **多数据源集成** — 博客（Notion / Ghost / 本地 MDX）、GitHub、LeetCode 三端同步
- **藏经阁** — 收藏并索引技术文章，支持关键词 + 语义混合检索
- **功法台** — 技能知识图谱可视化，自动从博客 / 刷题记录推导技能依赖关系
- **誓约系统** — 设定可验证目标，器灵每日自动核验完成进度
- **器灵 AI 助手** — 基于 LangGraph 的自适应多 Agent 系统，可联网搜索、分析记录、制定计划；五层记忆持久追踪修炼状态

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.local.example` 为 `.env.local` 并填入密钥：

```bash
cp .env.local.example .env.local
```

| 变量 | 用途 | 必填 |
|------|------|------|
| `NOTION_TOKEN` | Notion Integration Token | 使用 Notion 博客时 |
| `NOTION_DATABASE_ID` | Notion 博客数据库 ID | 使用 Notion 博客时 |
| `GITHUB_TOKEN` | GitHub Personal Access Token | 展示 GitHub 数据时 |
| `SPIRIT_API_KEY` | 器灵 AI 的 API Key（OpenAI 兼容） | 使用器灵时 |
| `SPIRIT_BASE_URL` | 自定义 API 端点（DeepSeek/Ollama 等） | 可选 |
| `SPIRIT_MODEL` | 模型名称（默认 `gpt-4o-mini`） | 可选 |
| `TAVILY_API_KEY` | 联网搜索 API Key（tavily.com） | 器灵联网搜索时 |
| `SYNC_SECRET` | `/api/spirit/sync` 接口鉴权密钥 | 生产环境 cron/webhook 调用时 |

### 3. 修改配置

编辑 `codelife.config.ts`，填入个人信息：

```typescript
site: {
  author: '你的名字',
  url: 'https://yourdomain.dev',
},
github: {
  username: 'your-github-username',
},
leetcode: {
  username: 'your-leetcode-username',
},
```

### 4. 启动开发服务器

```bash
npm run dev   # 默认端口 3002
```

访问 [http://localhost:3002](http://localhost:3002)

---

## 配置说明

所有配置集中在根目录的 `codelife.config.ts`，无需修改源代码。

### 博客数据源

```typescript
blog: {
  provider: 'notion',   // 'notion' | 'ghost' | 'local'
}
```

| provider | 说明 | 所需环境变量 |
|----------|------|-------------|
| `local` | 读取 `content/posts/` 下的 `.md` / `.mdx` 文件 | 无 |
| `notion` | 从 Notion Database 拉取 | `NOTION_TOKEN`, `NOTION_DATABASE_ID` |
| `ghost` | Ghost CMS API | `GHOST_URL`, `GHOST_CONTENT_API_KEY` |

### LeetCode 数据

```typescript
leetcode: {
  provider: 'manual',   // 'manual' | 'unofficial'
}
```

| provider | 说明 |
|----------|------|
| `manual` | 维护 `content/leetcode.yaml` 文件，最稳定 |
| `unofficial` | 国际版账号自动拉取（需 Cookie，可能失效） |

**manual 格式示例**：

```yaml
- id: 1
  title: 两数之和
  difficulty: easy
  language: Go
  solvedAt: 2026-01-01
  category: 哈希表
```

### 修为规则

```typescript
cultivation: {
  blog:    { shortPost: 80, longPost: 200 },   // 500-2000字 / 2000+字
  leetcode:{ easy: 30, medium: 80, hard: 200 },
  github:  { commit: 15 },
  streak:  { days7: 500, days30: 3000 },       // 连续打卡奖励
}
```

### 器灵 AI

```typescript
spirit: {
  enabled:              true,
  name:                 '青霄',           // 器灵名字
  model:                'gpt-4o-mini',   // 支持任何 OpenAI 兼容模型
  reflectModel:         'gpt-4o-mini',   // 周期记忆生成专用模型（默认同 model）
  maxToolRounds:        6,               // 最大工具调用轮数
  allowDynamicInstall:  false,           // 是否允许通过 /install 动态装载 MCP 包（生产关闭）
}
```

### MCP 服务配置

在 `codelife.config.ts` 的 `spirit.mcpServers` 中声明 MCP 服务，重启后自动加载：

```typescript
spirit: {
  mcpServers: [
    {
      name:      'Filesystem',
      namespace: 'fs',           // 工具名前缀，如 fs__read_file
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      agents:    ['qingxiao'],   // 哪些 Agent 可见（省略=qingxiao，'*'=全部）
    },
    {
      name:      'Memory Server',
      namespace: 'mem',
      transport: 'http',
      url:       'http://localhost:8080/mcp',
      agents:    ['*'],          // 所有 Agent 均可使用
    },
  ],
}
```

`agents` 字段控制工具可见范围，防止 MCP 工具过多导致无用上下文膨胀：

| `agents` 值 | 效果 |
|-------------|------|
| 省略 / `undefined` | 仅 `qingxiao`（主控）可见 |
| `['*']` | 所有 Agent 可见 |
| `['search_agent', 'qingxiao']` | 仅指定 Agent 可见 |

### 数据同步

器灵记忆系统需要数据同步才能感知修炼状态。触发方式：

- **自动**：每次对话时若当日无 DailyLog，自动执行 `syncToday()`
- **手动**：`POST /api/spirit/sync`（可配置 cron 或 webhook 触发）

每周一同步后自动生成 WeeklyPattern，每 7 天自动更新 PersonaProfile。

---

## 器灵 AI 使用指南

点击右下角金色光点，呼唤器灵。界面分为两个 Tab：

| Tab | 说明 |
|-----|------|
| **问道** | 对话与输入区（默认） |
| **法器** | 查看所有内置工具与 MCP 服务，可动态装载新法器 |

### 快捷命令

| 命令 | 说明 |
|------|------|
| `/观心` | 分析近期修炼状态 |
| `/指路` | 推荐今日该做什么 |
| `/问道` | 提问技术或概念问题 |
| `/立誓` | 设定一个可验证的目标 |
| `/藏经` | 收藏文章到藏经阁 |
| `/寻典` | 检索藏经阁中的文章 |
| `/此页` | 将当前页面内容注入对话上下文 |
| `/install <包名>` | 动态装载 MCP 包（需 `allowDynamicInstall: true`） |

### 多 Agent 模式

器灵内置自适应多 Agent 系统，根据任务自动选择执行策略：

| 策略 | 触发条件 | 执行方式 |
|------|----------|----------|
| **直通** | 简单问答、单一操作 | 青霄直接回答 |
| **调度** | 多步骤、有依赖关系 | 青霄调度 → 专项 Agent 串行执行 |
| **并行** | 多个独立子任务 | 多个 Agent 同时执行，合并结果 |

策略由 Planner 节点根据任务自动决策，无需手动选择。

---

## 藏经阁

在 `content/spirit/library/index.json` 维护收藏文章：

```json
[
  {
    "id": "unique-id",
    "url": "https://example.com/article",
    "title": "文章标题",
    "summary": "一句话摘要",
    "tags": ["标签1", "标签2"],
    "category": "算法",
    "savedAt": "2026-01-01"
  }
]
```

也可以通过器灵的 `/藏经` 命令自动收藏（会自动抓取页面内容生成摘要）。

---

## 项目结构

```
CodeLife/
├── codelife.config.ts        主配置文件
├── content/
│   ├── posts/                本地博客文章（Markdown/MDX）
│   ├── leetcode.yaml         LeetCode 刷题记录（manual 模式）
│   └── spirit/               器灵数据
│       ├── logs/             每日 DailyLog（自动生成）
│       ├── patterns/         每周 WeeklyPattern（LLM 生成）
│       ├── conversations/    对话历史（按日期）
│       ├── library/          藏经阁收藏
│       ├── persona.json      人格档案（LLM 生成）
│       └── vows.json         誓约记录
├── src/
│   ├── app/                  Next.js 路由页面
│   │   ├── api/spirit/       器灵 AI API
│   │   │   ├── chat/         主对话入口（SSE 流）
│   │   │   ├── mcp/          MCP 工具管理（查询 + 动态装载）
│   │   │   ├── session/      对话历史读写
│   │   │   ├── context/      页面上下文注入
│   │   │   ├── vows/         誓约 CRUD
│   │   │   └── sync/         数据同步 + 周期记忆生成
│   │   ├── blog/             博客页面
│   │   ├── github/           GitHub 统计页面
│   │   ├── leetcode/         LeetCode 记录页面
│   │   ├── resources/        藏经阁页面
│   │   └── gongfa/           功法台（技能图谱）
│   ├── components/
│   │   ├── SpiritWidget.tsx  器灵对话组件（问道/法器双 Tab）
│   │   ├── SkillGraph.tsx    技能依赖关系力导图
│   │   └── VowSidebar.tsx    当前誓约进度侧边栏
│   └── lib/
│       ├── adapters/         数据源适配器（blog/github/leetcode）
│       ├── cultivation/      修为与境界计算
│       ├── gongfa/           技能图谱推导（从博客/刷题记录提取节点）
│       └── spirit/           器灵 AI 核心（LangGraph 多 Agent）
│           ├── langgraph/    图编排（planner/supervisor/executor/synthesizer）
│           ├── tools/        内置工具注册
│           ├── memory.ts     五层记忆读写
│           ├── sync.ts       数据同步 + 记忆生成
│           ├── prompt.ts     System Prompt 构建
│           ├── hybrid-search.ts  博客/藏经阁混合检索（关键词 + embedding）
│           ├── mcp-loader.ts MCP 服务加载
│           └── registry.ts   工具注册表
```

详细架构文档见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 境界体系

| 境界 | 所需修为 |
|------|---------|
| 炼气期·一重 | 0 |
| 炼气期·九重 | 500 |
| 筑基期 | 1,500 |
| 金丹期 | 5,000 |
| 元婴期 | 15,000 |
| 化神期 | 40,000 |
| 炼虚期 | 100,000 |
| 合体期 | 250,000 |
| 大乘期 | 600,000 |
| 渡劫·飞升 | 1,000,000 |

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript 5 |
| 样式 | Tailwind CSS 4 |
| AI 编排 | LangGraph.js |
| 数据验证 | Zod |
| 博客内容 | Notion / MDX |
| 数据来源 | GitHub API, LeetCode GraphQL |
| 部署 | Vercel（推荐） |

---

## 部署

推荐部署到 Vercel：

```bash
npm run build
```

在 Vercel 项目设置中添加所有 `.env.local` 中的环境变量即可。
