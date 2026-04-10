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

/** getPost() 返回的正文详情部分 */
export interface PostContent {
  content: string
  excerpt: string
  wordCount: number
  readingMinutes: number
  pointsEarned: number
  pointsLabel: string
}

export interface BlogAdapter {
  /** 获取所有已发布文章元数据（最新在前，content 为空字符串） */
  getPosts(): Promise<BlogPost[]>
  /** 通过 pageId 获取正文。不做 null-catch，错误直接抛出让调用方决定是否缓存 */
  getPostContentById(pageId: string): Promise<PostContent>
}
