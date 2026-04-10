/**
 * Web 工具：抓取 URL 内容，提取纯文本
 */

import { registerTool } from '../registry'

/** 把 HTML 转成可读纯文本 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|p|div|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 从 HTML 里提取 <title> */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return m ? m[1].trim() : ''
}

registerTool({
  name:        'fetch_url',
  description: '抓取指定 URL 的页面内容，返回标题和纯文本。通常配合 collect_document 使用：先 fetch_url 获取内容，再 collect_document 收藏。',
  parameters: {
    type: 'object',
    properties: {
      url:        { type: 'string', description: '要抓取的网页 URL' },
      maxLength: { type: 'number', description: '最大返回字符数，默认 4000' },
    },
    required: ['url'],
  },
}, async ({ url, maxLength = 4000 }) => {
  const target = url as string

  const res = await fetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CodeLife-Spirit/1.0)',
      'Accept':     'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    return { content: `抓取失败：HTTP ${res.status}`, brief: `抓取失败 ${res.status}` }
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    return { content: `不支持的内容类型：${contentType}`, brief: '不支持的内容类型' }
  }

  const html  = await res.text()
  const title = extractTitle(html)
  const text  = htmlToText(html).slice(0, maxLength as number)

  return {
    content: JSON.stringify({ title, text, url: target }),
    brief:   title ? `已抓取「${title}」` : `已抓取 ${target}`,
  }
}, { displayName: '抓取页面内容' })
