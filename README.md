# 道途 · CodeLife

> 以修仙为皮，以成长为骨。  
> 将每一篇文章、每一道算法题、每一次提交，炼化为可量化的修为，驱动境界升级。  
> 由 AI 器灵常伴左右，观心问道，记忆相随。

---

## 它是什么

CodeLife 是一个**个人学习成长追踪站**，将程序员日常的三件事——写作、刷题、开源贡献——映射到修仙世界观里：

| 现实 | 道途 |
|------|------|
| 写一篇博客 | 著述，获得修为 |
| 刷一道算法题 | 铸剑，积累内功 |
| 推送一次代码 | 积累声望 |
| 连续打卡 N 天 | 连续不辍，额外奖励 |
| 修为累积到阈值 | 境界突破（炼气 → 筑基 → 金丹 → … → 飞升） |

不是游戏，但有目标感。不是打卡 App，但有数据支撑。

---

## 核心功能

### 修为体系

所有学习行为自动量化为「修为」。在 `codelife.config.ts` 中可自由调整每种行为的修为权重，修为累积驱动境界升级（共 10 级境界）。

### 多数据源自动同步

- **博客**：Notion Database / Ghost CMS / 本地 Markdown，自动拉取并统计字数计算修为
- **铸剑（LeetCode）**：支持力扣中文版（Cookie 自动拉取）、国际版、手动维护三种模式
- **声望（GitHub）**：通过 GitHub API 拉取 commit 记录与仓库数据

### 藏经阁

收藏技术文章，自动抓取正文生成摘要，建立本地向量索引。支持 BM25 关键词 + 语义向量 RRF 融合的混合检索，找到你曾经存过的那篇文章。

### 功法台

从博客分类、刷题记录中自动推导技能依赖关系，生成可交互的力导图。可视化你的技术栈全貌，看清哪些方向已入门、哪些还是空白。

### 誓约系统

向器灵立下可验证的目标（如「连续 30 天每日刷题」）。器灵每日自动核验进度，完成则记录成就，失约则如实相告。

---

## 器灵 · 青霄

> 器灵不只是聊天机器人。它了解你的修炼记录，拥有自己的记忆，能动手执行任务。

点击页面右下角金色光点，呼唤器灵。

### 记忆系统

器灵拥有**五层持久化记忆**，跨会话累积，对话越多越了解你：

| 层级 | 内容 | 更新频率 |
|------|------|----------|
| 今日状态 | 当日修炼摘要 + 誓约进度 | 每次对话自动注入 |
| 每日日志 | 近期各类活动详情 | 每日同步时生成 |
| 周规律 | AI 归纳的修炼模式与隐患 | 每周一自动生成 |
| 人格档案 | 长期观察到的偏好与习惯 | 每 7 天更新 |
| 技术洞察 | 从对话中提炼的技能卡片 | 每次深度技术对话后 |

### 工具能力

器灵不止于「聊」，它拥有完整的工具集，能主动获取信息、操作数据：

**数据查询**
- 读取博客文章、刷题记录、修为统计
- 检索历史对话（BM25 + 语义混合）
- 检索藏经阁收藏文章
- 读取每日日志、周规律分析

**联网能力**
- 联网搜索（Tavily API）
- 抓取任意 URL 正文

**文件系统**
- 浏览项目目录结构（`list_files`）
- 读取文件内容（`read_file`，支持行号定位）
- 执行 shell 命令（三级安全分类，见下文）

**写操作（需 UI 确认）**
- 收藏文章到藏经阁
- 创建 / 更新 / 删除誓约
- 写笔记、记录技术洞察

**MCP 扩展**
- 支持运行时动态装载任意 MCP 工具包（`/install` 命令）
- 配置中预声明的 MCP 服务随应用启动自动连接

### Shell 执行与安全机制

器灵可以真正执行 shell 命令，但配有**三级安全分类**：

| 级别 | 示例 | 处理方式 |
|------|------|----------|
| 安全 | `ls`、`cat`、`git status`、`git log` | 直接执行，无提示 |
| 中危 | `git commit`、`npm install`、文件写入 | 弹出确认框，可选「执行一次」或「本次会话允许」 |
| 高危 | `rm -rf`、`sudo`、`kill` | 弹出确认框，标注高危，可选「执行一次」或「拒绝」 |

用户在 UI 中点击确认后，器灵拿到一次性令牌继续执行。选择「本次会话允许」后同类命令不再重复询问。

### 自适应多 Agent 架构

器灵内部基于 **LangGraph** 实现多 Agent 编排，根据任务复杂度自动选择最优策略：

```
用户输入
    │
    ▼
[快速分类器]  ← 纯规则，无 LLM 调用，毫秒级判断
    │
    ├─→ 直通（默认）─────────────────────────────→ 青霄直接回答
    │                                              （支持多轮工具调用）
    │
    ├─→ 调度（串行）─→ 青霄制定计划
    │                   │
    │                   ├─→ 搜寻使（web_search / fetch_url）
    │                   ├─→ 算法师（读取刷题/博客数据）
    │                   └─→ 星盘官（分析修炼状态）
    │                           │
    │                           └─────────────→ 青霄整合回答
    │
    └─→ 并行──────────→ 多个专项 Agent 同时执行
                                │
                                └─────────────→ 合并器汇总输出
```

**专项 Agent 说明**：

| Agent | 职责 | 工具集 |
|-------|------|--------|
| 青霄（qingxiao） | 全能主理，直通模式下独立完成全部任务 | 全部工具 |
| 搜寻使（search_agent） | 专注联网信息检索 | `web_search`、`fetch_url` |
| 算法师（code_agent） | 读取分析刷题与博客数据 | 博客、刷题、藏经阁工具 |
| 星盘官（planner_agent） | 分析修炼规律、制定计划 | 日志、刷题、对话历史工具 |

**策略选择原则**：直通是强默认。只有当后续步骤明确依赖前步专项 Agent 的具体输出时，才切换为串行调度；只有存在 2 个以上明确独立的专项任务时，才使用并行。避免过度编排。

### 思维链支持

使用 DeepSeek-R1、QwQ 等推理模型时，器灵的内部推演过程会以可折叠的「推演」块实时流式展示，既透明又不喧宾夺主。

### 快捷命令

| 命令 | 说明 |
|------|------|
| `/观心` | 分析近期修炼状态，指出规律与隐患 |
| `/指路` | 根据当前状态推荐今日应做什么 |
| `/问道` | 提问技术或概念问题，可联网搜索 |
| `/立誓` | 向器灵立下一个可自动核验的目标 |
| `/藏经` | 粘贴 URL，自动抓取收藏到藏经阁 |
| `/寻典` | 用自然语言检索藏经阁中的文章 |
| `/此页` | 将当前页面内容注入对话上下文 |
| `/install <包名>` | 动态装载 MCP 工具包（需开启 `allowDynamicInstall`） |

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
| `SPIRIT_BASE_URL` | 自定义 API 端点（DeepSeek / Ollama 等） | 可选 |
| `SPIRIT_MODEL` | 模型名称（默认 `gpt-4o-mini`） | 可选 |
| `TAVILY_API_KEY` | 联网搜索 API Key（tavily.com） | 器灵联网搜索时 |
| `LEETCODE_CN_COOKIE` | 力扣中文版 Cookie（`LEETCODE_SESSION=xxx; csrftoken=yyy`） | 使用 cn provider 时 |
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
  provider: 'cn',           // 'cn' | 'manual' | 'unofficial'
  username: 'your-username',
},
```

### 4. 启动开发服务器

```bash
npm run dev   # 默认端口 3002
```

访问 [http://localhost:3002](http://localhost:3002)

**局域网访问**：加 `-H 0.0.0.0` 监听所有网卡，并在 `next.config.ts` 的 `allowedDevOrigins` 中添加本机 IP：

```bash
npm run dev -- -H 0.0.0.0
```

---

## 配置说明

所有配置集中在根目录的 `codelife.config.ts`，无需修改源代码。

### 博客数据源

| provider | 说明 | 所需环境变量 |
|----------|------|-------------|
| `local` | 读取 `content/posts/` 下的 `.md` / `.mdx` 文件 | 无 |
| `notion` | 从 Notion Database 拉取，字数缓存到本地避免重复请求 | `NOTION_TOKEN`, `NOTION_DATABASE_ID` |
| `ghost` | Ghost CMS Content API | `GHOST_URL`, `GHOST_CONTENT_API_KEY` |

### LeetCode 数据

| provider | 说明 | 所需配置 |
|----------|------|---------|
| `cn` | 力扣中文版，Cookie 自动拉取（推荐国内用户） | `LEETCODE_CN_COOKIE` |
| `unofficial` | LeetCode 国际版，GraphQL 自动拉取 | Cookie |
| `manual` | 手动维护 `content/leetcode.yaml`，最稳定 | 无 |

**cn 模式配置**：浏览器登录 leetcode.cn → F12 → Application → Cookies，复制 `LEETCODE_SESSION` 和 `csrftoken`，填入 `.env.local`：

```env
LEETCODE_CN_COOKIE=LEETCODE_SESSION=xxx; csrftoken=yyy
```

Cookie 过期后重新复制即可。题目难度自动查询并缓存到本地，不会重复请求。

### 修为规则

```typescript
cultivation: {
  blog:    { shortPost: 80, longPost: 200 },    // 500-2000字 / 2000+字
  leetcode:{ easy: 30, medium: 80, hard: 200 },
  github:  { commit: 15 },
  streak:  { days7: 500, days30: 3000 },        // 连续打卡奖励
}
```

### 器灵配置

```typescript
spirit: {
  enabled:             true,
  name:                '青霄',         // 器灵名字，随意改
  model:               'gpt-4o-mini', // 支持任何 OpenAI 兼容模型
  maxToolRounds:       6,             // 最大工具调用轮数
  allowDynamicInstall: false,         // 是否允许 /install 动态装载 MCP 包（生产关闭）
  mcpServers: [
    // 预声明的 MCP 服务，随应用启动自动连接
    // {
    //   name: 'Brave搜索', transport: 'stdio',
    //   command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'],
    //   env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY ?? '' },
    //   agents: ['search_agent', 'qingxiao'],
    // },
  ],
}
```

### 数据同步

器灵记忆系统依赖数据同步，触发方式：

- **自动**：每次对话时若当日无日志，自动执行同步
- **手动**：`GET /api/sync?source=blog|github|leetcode|all`（未设 `SYNC_SECRET` 时无需鉴权）

每周一同步后自动生成周规律分析，每 7 天自动更新人格档案。

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

阈值与修为权重均可在 `codelife.config.ts` 中自由调整。

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript 5 |
| AI 编排 | LangGraph.js |
| 数据验证 | Zod |
| 博客内容 | Notion / Ghost / MDX |
| 混合检索 | MiniSearch (BM25) + OpenAI Embeddings (RRF 融合) |
| 数据来源 | GitHub API · LeetCode GraphQL |
| 部署 | Vercel（推荐） |

---

## 项目结构

```
CodeLife/
├── codelife.config.ts        主配置文件（唯一需要改的文件）
├── content/
│   ├── posts/                本地博客（Markdown/MDX）
│   ├── leetcode.yaml         LeetCode 手动模式数据
│   ├── blog_wc_cache.json    博客字数持久缓存
│   └── spirit/               器灵持久化数据
│       ├── logs/             每日修炼日志
│       ├── patterns/         每周规律分析（LLM 生成）
│       ├── conversations/    对话历史（按日期）
│       ├── summaries/        对话摘要
│       ├── library/          藏经阁（index.json + embeddings）
│       ├── persona.json      人格档案
│       ├── vows.json         誓约记录
│       ├── blog_posts_cache.json  博客元数据缓存
│       └── skill_cards.json  技术洞察卡片
└── src/
    ├── app/                  Next.js 路由
    │   ├── api/spirit/       器灵 AI 接口
    │   │   ├── chat/         对话入口（SSE 流式响应）
    │   │   ├── approve/      权限令牌审批
    │   │   ├── mcp/          MCP 工具管理
    │   │   ├── session/      对话历史读写
    │   │   ├── context/      页面上下文注入
    │   │   ├── vows/         誓约 CRUD
    │   │   └── sync/         数据同步
    │   ├── blog/             博客页面
    │   ├── github/           GitHub 声望页面
    │   ├── leetcode/         铸剑台页面
    │   ├── resources/        藏经阁页面
    │   └── gongfa/           功法台（技能图谱）
    ├── components/
    │   ├── SpiritWidget.tsx  器灵对话组件
    │   ├── SkillGraph.tsx    技能依赖力导图
    │   └── VowSidebar.tsx    誓约进度侧边栏
    └── lib/
        ├── adapters/         数据源适配器（blog / github / leetcode）
        ├── cultivation/      修为与境界计算
        ├── gongfa/           技能图谱推导
        └── spirit/           器灵 AI 核心
            ├── langgraph/    多 Agent 图编排
            ├── tools/        内置工具（shell / 文件 / 记忆 / 搜索 / 藏经阁…）
            ├── memory.ts     五层记忆读写
            ├── sync.ts       数据同步与记忆生成
            ├── prompt.ts     System Prompt 构建
            └── hybrid-search.ts  BM25 + Embedding 混合检索
```

---

## 部署

推荐 Vercel 一键部署：

```bash
npm run build
```

在 Vercel 项目设置中添加 `.env.local` 中的所有环境变量即可。Cookie 类 Token（`LEETCODE_CN_COOKIE`）过期后在 Vercel 环境变量中更新重新部署。
