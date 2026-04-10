/** 功法知识图谱数据结构 */

export type SkillGroup =
  | 'category'   // 博客一级分类
  | 'tag'        // 博客标签
  | 'algo'       // 算法题型
  | 'language'   // 编程语言（刷题/博客中提取）

export interface SkillSource {
  type:   'blog' | 'leetcode'
  title:  string
  date:   string
  detail?: string   // e.g. "easy  1200字"
}

export interface SkillNode {
  id:        string
  name:      string
  group:     SkillGroup
  weight:    number         // 0–100 熟练度
  rawCount:  number         // 原始数量（文章数 / 题数）
  sources:   SkillSource[]
  url?:      string         // 点击跳转地址（tag/category 节点有值，algo/language 无）
}

export interface SkillEdge {
  source: string  // node id
  target: string  // node id
  weight: number  // 共现次数，影响边粗细
}

export interface SkillGraph {
  nodes: SkillNode[]
  edges: SkillEdge[]
}
