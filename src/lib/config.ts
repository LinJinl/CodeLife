export type BlogProvider = 'local' | 'notion' | 'ghost'
export type LeetcodeProvider = 'unofficial' | 'manual' | 'cn'

export interface SiteConfig {
  title: string
  subtitle: string
  author: string
  url: string
  locale?: string
}

export interface BlogConfig {
  provider: BlogProvider
  localDir?: string
  notion?: {
    token: string
    databaseId: string
    fieldMap?: {
      title?: string
      category?: string
      published?: string
      publishedAt?: string
      slug?: string
    }
  }
  ghost?: {
    url: string
    apiKey: string
    version?: string
  }
}

export interface GithubConfig {
  enabled: boolean
  username: string
  token?: string
  pinnedRepos?: string[]
  revalidate?: number
}

export interface LeetcodeConfig {
  enabled: boolean
  username: string
  provider: LeetcodeProvider
  unofficial?: {
    cookie?: string
  }
  manual?: {
    dataFile: string
  }
  cn?: {
    /** leetcode.cn 用户名（用于 GraphQL 查询） */
    username: string
    /**
     * 从浏览器 DevTools 复制的 Cookie 字符串（推荐）。
     * 格式：LEETCODE_SESSION=xxx; csrftoken=yyy
     * 浏览器登录后：F12 → Application → Cookies → leetcode.cn → 复制这两个值
     */
    cookie?: string
  }
  revalidate?: number
}

export interface CultivationConfig {
  blog: { shortPost: number; longPost: number }
  leetcode: { easy: number; medium: number; hard: number }
  github: { commit: number }
  misc: { book: number }
  streak: { days7: number; days30: number }
}

export interface RealmConfig {
  name: string
  stage: string
  threshold: number
}

// MCP 服务器配置
export type MCPTransport = 'http' | 'stdio'

export interface MCPServerConfig {
  /** 展示名，如"文件系统"  */
  name: string
  /** 工具名前缀，如 "fs" → 工具名 "fs__read_file"（默认取 name 小写+下划线） */
  namespace?: string
  transport: MCPTransport
  // HTTP 模式
  url?: string
  headers?: Record<string, string>
  // stdio 模式
  command?: string
  args?: string[]
  env?: Record<string, string>
  /**
   * 允许使用此 MCP server 工具的 agent 列表。
   * 不填 / undefined → 仅 qingxiao（全能器灵）可用，专项 agent 不可用。
   * ['qingxiao', 'search_agent'] → 指定多个 agent 均可用。
   * ['*'] → 所有 agent 均可用（慎用，会使所有 agent 上下文变长）。
   *
   * 示例：联网搜索类 MCP → agents: ['search_agent', 'qingxiao']
   *       文件读写类 MCP → agents: ['qingxiao']（默认，不填即可）
   */
  agents?: string[]
}

export interface SpiritConfig {
  enabled: boolean
  name?: string              // 器灵名字，默认"青霄"
  apiKey: string             // OpenAI-compatible key
  baseURL?: string           // 自定义端点，默认 OpenAI 官方
  model?: string             // 主对话模型，默认 gpt-4o-mini（建议换成更强的模型）
  plannerModel?: string      // Planner 专用模型（可用更轻量的模型，默认同 model）
  reflectModel?: string      // 周期反思用的模型，默认同 model
  maxToolRounds?: number     // ReAct 最大工具调用轮数，默认 6
  /** 从配置加载的 MCP 服务器列表 */
  mcpServers?: MCPServerConfig[]
  /**
   * 是否允许运行时通过 /install 命令动态安装 MCP 包。
   * 默认 false。本地调试时可设为 true，生产环境建议关闭。
   */
  allowDynamicInstall?: boolean
}

export interface CodeLifeConfig {
  site: SiteConfig
  blog: BlogConfig
  github: GithubConfig
  leetcode: LeetcodeConfig
  cultivation: CultivationConfig
  realms: RealmConfig[]
  spirit?: SpiritConfig
}

export function defineConfig(config: CodeLifeConfig): CodeLifeConfig {
  return config
}
