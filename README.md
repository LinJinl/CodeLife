# 道途 · CodeLife

> 一个修仙风格的个人学习成长网站。将写作、刷题、开源贡献转化为修为，追踪境界提升，由 AI 器灵陪伴修炼。

---

## 功能特性

- **修为体系** — 每篇博文、每道算法题、每次 commit 都产生修为，驱动境界升级
- **多数据源集成** — 博客（Notion / Ghost / 本地 MDX）、GitHub、LeetCode 三端同步
- **藏经阁** — 收藏并索引技术文章，支持关键词 + 语义混合检索
- **功法台** — 技能知识图谱可视化，自动从博客 / 刷题记录推导技能依赖关系
- **誓约系统** — 设定可验证目标，器灵每日自动核验完成进度
- **器灵 AI 助手** — 基于 LangGraph 的自适应多 Agent 系统，可联网搜索、执行 shell 命令、分析记录、制定计划；五层记忆持久追踪修炼状态
- **shell 执行能力** — 器灵可执行 shell 命令，三级安全分类（安全/中危/高危），中高危命令需通过 UI 权限弹窗确认
- **写操作权限门控** — 收藏、立誓、删除等写操作需用户在 UI 中明确确认，防止误触

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
| `SYNC_SECRET` | `/api/sync` 接口鉴权密钥 | 生产环境 cron/webhook 调用时 |

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

Notion adapter 会将每篇文章的字数缓存到 `content/blog_wc_cache.json`（按 pageId + last_edited_time），避免每次都拉正文。

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
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      agents:    ['qingxiao'],   // 哪些 Agent 可见（省略=qingxiao，'*'=全部）
    },
  ],
}
```

### 数据同步

器灵记忆系统需要数据同步才能感知修炼状态。触发方式：

- **自动**：每次对话时若当日无 DailyLog，自动执行 `syncToday()`
- **手动**：`GET /api/sync?source=blog|github|leetcode|all`（未设 `SYNC_SECRET` 时无需鉴权）

每周一同步后自动生成 WeeklyPattern，每 7 天自动更新 PersonaProfile。

---

## 器灵 AI 使用指南

点击右下角金色光点，呼唤器灵。

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

### 工具执行透明度

每个工具调用在消息下方显示执行步骤，包含：
- 工具名与入参摘要
- 执行结果摘要（brief）
- 搜索/抓取结果的可点击链接

### 思考过程

使用支持思维链的模型（DeepSeek-R1 / QwQ 等）时，器灵的推理过程以可折叠的「推演」块显示。

### 权限确认

器灵执行以下操作时会弹出确认提示：

| 操作类型 | 触发条件 | 选项 |
|----------|----------|------|
| **Shell 中危命令** | git commit/push、npm install、文件写入等 | 执行一次 / 本次会话允许 / 拒绝 |
| **Shell 高危命令** | rm -rf、sudo、kill 等 | 执行一次 / 拒绝 |
| **写操作** | 收藏文章、创建/删除誓约 | 确认 / 拒绝 |

安全命令（ls、cat、git status 等只读操作）直接执行，无需确认。

### 多 Agent 模式

器灵内置自适应多 Agent 系统，根据任务自动选择执行策略：

| 策略 | 触发条件 | 执行方式 |
|------|----------|----------|
| **直通** | 简单问答、单一操作（强默认） | 青霄直接回答 |
| **调度** | 后续步骤明确依赖前步具体输出，且需专项 Agent | 青霄调度 → 专项 Agent 串行执行 |
| **并行** | 2+ 个明确独立子任务，各需不同专项 Agent | 多个 Agent 同时执行，合并结果 |

---

## 藏经阁

通过器灵的 `/藏经` 命令自动收藏（会自动抓取页面内容生成摘要），或直接编辑 `content/spirit/library/index.json`。

---

## 项目结构

```
CodeLife/
├── codelife.config.ts        主配置文件
├── content/
│   ├── posts/                本地博客文章（Markdown/MDX）
│   ├── leetcode.yaml         LeetCode 刷题记录（manual 模式）
│   ├── blog_wc_cache.json    博客字数持久缓存（pageId → wordCount）
│   └── spirit/               器灵数据
│       ├── logs/             每日 DailyLog（自动生成）
│       ├── patterns/         每周 WeeklyPattern（LLM 生成）
│       ├── summaries/        对话摘要（按日期）
│       ├── conversations/    对话历史（按日期）
│       ├── library/          藏经阁收藏（index.json + embeddings）
│       ├── persona.json      人格档案（LLM 生成）
│       ├── vows.json         誓约记录
│       ├── blog_posts_cache.json   博客元数据缓存（供器灵离线搜索）
│       └── skill_cards.json  技术洞察卡片
├── src/
│   ├── app/                  Next.js 路由页面
│   │   ├── api/spirit/       器灵 AI API
│   │   │   ├── chat/         主对话入口（SSE 流）
│   │   │   ├── approve/      权限令牌审批（shell/写操作确认）
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
│   │   ├── SpiritWidget.tsx  器灵对话组件
│   │   ├── SkillGraph.tsx    技能依赖关系力导图
│   │   └── VowSidebar.tsx    当前誓约进度侧边栏
│   └── lib/
│       ├── adapters/         数据源适配器（blog/github/leetcode）
│       ├── cultivation/      修为与境界计算
│       ├── gongfa/           技能图谱推导
│       └── spirit/           器灵 AI 核心（LangGraph 多 Agent）
│           ├── langgraph/    图编排（planner/supervisor/executor/synthesizer）
│           │   └── classify.ts   纯规则快速分类器（绕过 Planner LLM 调用）
│           ├── tools/        内置工具注册
│           │   ├── shell.ts      run_shell（三级安全分类）
│           │   ├── files.ts      list_files / read_file
│           │   ├── memory-read.ts   get_daily_logs / get_weekly_patterns / get_skill_cards / search_conversations
│           │   ├── memory-write.ts  write_note / update_persona_observation / save_skill_card
│           │   ├── skills.ts     search_skills
│           │   ├── library.ts    collect_document / search_library / list_library
│           │   ├── vow.ts        list_vows / create_vow / update_vow / delete_vow
│           │   ├── codelife.ts   read_user_blogs / read_leetcode_records / read_cultivation_stats / search_blog_posts
│           │   └── search.ts     web_search / fetch_url
│           ├── shell-permissions.ts  三级权限状态机（令牌生成/消费）
│           ├── skill-extractor.ts    从对话中提炼技术洞察
│           ├── summarize.ts          对话摘要生成
│           ├── memory.ts     五层记忆读写
│           ├── sync.ts       数据同步 + 记忆生成
│           ├── prompt.ts     System Prompt 构建
│           ├── hybrid-search.ts  博客/藏经阁混合检索（BM25 + embedding RRF）
│           ├── mcp-loader.ts MCP 服务加载
│           └── registry.ts   工具注册表（含写操作权限门控）
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
| 框架 | Next.js 15 (App Router) |
| 语言 | TypeScript 5 |
| AI 编排 | LangGraph.js |
| 数据验证 | Zod |
| 博客内容 | Notion / MDX |
| 混合检索 | MiniSearch (BM25) + OpenAI Embeddings (RRF 融合) |
| 数据来源 | GitHub API, LeetCode GraphQL |
| 部署 | Vercel（推荐） |

---

## 部署

推荐部署到 Vercel：

```bash
npm run build
```

在 Vercel 项目设置中添加所有 `.env.local` 中的环境变量即可。
