/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              CodeLife 主配置文件                              ║
 * ║  修改此文件来接入你的数据源、调整修为规则、定制站点信息         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 快速上手：
 *   1. 填写 site.author / site.url
 *   2. 选择 blog.provider，按注释填入对应凭据
 *   3. 填写 github.username
 *   4. 填写 leetcode.username
 *   5. 所有密钥统一放到 .env.local，绝不硬编码
 */

import { defineConfig } from '@/lib/config'

export default defineConfig({

  // ─────────────────────────────────────────────
  // 站点基础信息
  // ─────────────────────────────────────────────
  site: {
    title: '道途',
    subtitle: '一个修仙者的藏经阁',
    author: 'YOUR_NAME',          // ← 改成你的名字
    url: 'https://yourdomain.dev', // ← 改成你的域名
    locale: 'zh-CN',
  },

  // ─────────────────────────────────────────────
  // 博客内容源
  // ─────────────────────────────────────────────
  // provider 可选值：
  //   'local'   本地 ./content/posts 目录下的 .mdx / .md 文件（默认）
  //   'notion'  Notion Database（需要设置 NOTION_TOKEN + NOTION_DATABASE_ID）
  //   'ghost'   Ghost CMS（需要设置 GHOST_URL + GHOST_CONTENT_API_KEY）
  //
  blog: {
    provider: 'notion',
    // ── Local MDX ────────────────────────────────
    localDir: './content/posts',   // 相对于项目根目录
    // ── Notion ───────────────────────────────────
     notion: {
       token:      process.env.NOTION_TOKEN!,
       databaseId: process.env.NOTION_DATABASE_ID!,
       fieldMap: {
         title:        'title',
         category:     'category',
         published:    'status',      // select 类型，值为 "Published" 表示公开
         publishedAt:  'date',
         slug:         'slug',
       },
     },
    // ── Ghost ────────────────────────────────────
    // ghost: {
    //   url:    process.env.GHOST_URL!,           // 例：https://blog.yourdomain.com
    //   apiKey: process.env.GHOST_CONTENT_API_KEY!, // Content API Key
    //   version: 'v5.0',
    // },
  },

  // ─────────────────────────────────────────────
  // GitHub 集成
  // ─────────────────────────────────────────────
  // 需要在 .env.local 设置：GITHUB_TOKEN
  // Token 权限：read:user, read:org（只读即可）
  // 申请地址：https://github.com/settings/tokens
  //
  github: {
    enabled: true,
    username: 'YOUR_GITHUB_USERNAME', // ← 改成你的 GitHub 用户名
    token: process.env.GITHUB_TOKEN,
    // 只展示这些仓库（留空则展示全部 public repo）
    pinnedRepos: [],
    // 同步间隔（秒），用于 ISR revalidate。默认 3600（1 小时）
    revalidate: 3600,
  },

  // ─────────────────────────────────────────────
  // LeetCode 集成
  // ─────────────────────────────────────────────
  // LeetCode 无官方 API。目前支持两种方式：
  //   'unofficial' 使用非官方 GraphQL 端点（leetcode.com/graphql）—— 国际版
  //   'manual'     手动通过 YAML 文件维护题目记录（最稳定，推荐国内用户）
  //
  // 注意：unofficial 方式可能因 LeetCode 更改接口而失效，
  //       届时只需切换到 'manual' 即可保持功能完整。
  //
  leetcode: {
    enabled: true,
    username: 'YOUR_LEETCODE_USERNAME', // ← 改成你的 LeetCode 用户名（显示用）
    provider: 'cn',                     // 'cn' | 'manual' | 'unofficial'

    // ── CN（力扣中文版，Cookie 认证）───────────────────────────
    // 1. 浏览器登录 leetcode.cn
    // 2. F12 → Application → Cookies → https://leetcode.cn
    // 3. 复制 LEETCODE_SESSION 和 csrftoken 两个值
    // 4. .env.local 添加：
    //      LEETCODE_CN_USERNAME=你的用户名（力扣主页 URL 里的那个）
    //      LEETCODE_CN_COOKIE=LEETCODE_SESSION=xxx; csrftoken=yyy
    cn: {
      username: process.env.LEETCODE_CN_USERNAME!,
      cookie:   process.env.LEETCODE_CN_COOKIE,
    },

    // ── manual（历史记录手动补充）────────────────────────────────
    // manual: {
    //   dataFile: './content/leetcode.yaml',
    // },
    revalidate: 86400, // 24 小时
  },

  // ─────────────────────────────────────────────
  // 修为规则（可以自由调整数值）
  // ─────────────────────────────────────────────
  cultivation: {
    // 博文修为
    blog: {
      shortPost:  80,   // 500–2000 字：顿悟
      longPost:   200,  // 2000+ 字：大悟
    },
    // LeetCode 修为
    leetcode: {
      easy:   30,   // 小试炼
      medium: 80,   // 中试炼
      hard:   200,  // 大试炼
    },
    // GitHub 修为
    github: {
      commit: 15,   // 铸剑一锤（每次 commit）
    },
    // 其他
    misc: {
      book:  300,   // 读完一本书
    },
    // 连续打卡奖励
    streak: {
      days7:  500,
      days30: 3000,
    },
  },

  // ─────────────────────────────────────────────
  // 器灵 AI 助手
  // ─────────────────────────────────────────────
  // 使用任何 OpenAI 兼容的 API（OpenAI / DeepSeek / Ollama 等）
  // .env.local 配置：
  //   SPIRIT_API_KEY=sk-xxx
  //   SPIRIT_BASE_URL=https://api.deepseek.com/v1   （可选，默认 OpenAI）
  //
  spirit: {
    enabled: true,
    name: '青霄',
    apiKey:  process.env.SPIRIT_API_KEY  ?? '',
    baseURL: process.env.SPIRIT_BASE_URL,          // 不填则用 OpenAI 官方地址
    model:        process.env.SPIRIT_MODEL ?? 'gpt-4o-mini',
    maxToolRounds: 6,   // ReAct 最大工具调用轮数，超出后强制返回已有结果

    // ── MCP 扩展 ───────────────────────────────────────────────
    // 允许运行时通过 /install 命令动态安装 MCP 包（本地调试用，生产建议关闭）
    allowDynamicInstall: true,

    // 从配置预加载的 MCP 服务器列表（随应用启动自动连接）
    // transport: 'http'  → url 字段必填（连接已运行的 HTTP MCP server）
    // transport: 'stdio' → command + args 字段必填（按需 spawn 子进程）
    mcpServers: [
      // ── agents 字段说明 ────────────────────────────────────
      // 不填 agents（默认）→ 仅 qingxiao 可用（推荐，防止上下文过长）
      // agents: ['qingxiao', 'search_agent'] → 指定多个 agent 均可用
      // agents: ['*'] → 所有 agent 均可用（慎用）

      // 示例：联网搜索增强（search_agent 和 qingxiao 均可用）
      // {
      //   name: 'Brave搜索',
      //   transport: 'stdio',
      //   command: 'npx',
      //   args: ['-y', '@modelcontextprotocol/server-brave-search'],
      //   env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY ?? '' },
      //   agents: ['search_agent', 'qingxiao'],
      // },

      // 示例：文件系统工具（仅 qingxiao，不污染专项 agent）
      // {
      //   name: '文件系统',
      //   transport: 'stdio',
      //   command: 'npx',
      //   args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      //   // agents 不填，默认仅 qingxiao
      // },
    ],
  },

  // ─────────────────────────────────────────────
  // 境界体系（一般不需要改）
  // ─────────────────────────────────────────────
  realms: [
    { name: '炼气期', stage: '一重',  threshold: 0 },
    { name: '炼气期', stage: '九重',  threshold: 500 },
    { name: '筑基期', stage: '',       threshold: 1500 },
    { name: '金丹期', stage: '',       threshold: 5000 },
    { name: '元婴期', stage: '',       threshold: 15000 },
    { name: '化神期', stage: '',       threshold: 40000 },
    { name: '炼虚期', stage: '',       threshold: 100000 },
    { name: '合体期', stage: '',       threshold: 250000 },
    { name: '大乘期', stage: '',       threshold: 600000 },
    { name: '渡劫·飞升', stage: '',   threshold: 1000000 },
  ],
})
