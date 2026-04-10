export interface BlogPost {
  id: string
  slug: string
  title: string
  /** 已渲染的 HTML 或 MDX source，取决于 adapter。列表页可为空字符串，getPost() 才保证有值 */
  content: string
  excerpt: string
  category: string
  tags: string[]
  wordCount: number
  readingMinutes: number
  publishedAt: Date
  /** 对应 cultivation 配置中的 shortPost / longPost */
  pointsEarned: number
  pointsLabel: string // 顿悟 / 大悟
}

export interface BlogAdapter {
  /** 获取所有已发布文章（最新在前） */
  getPosts(): Promise<BlogPost[]>
  /** 通过 slug 获取单篇 */
  getPost(slug: string): Promise<BlogPost | null>
}
