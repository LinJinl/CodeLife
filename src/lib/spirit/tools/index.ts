/**
 * 工具统一入口 — import 此文件触发所有内置工具的注册
 *
 * 扩展方式：
 *   1. 添加新工具文件，在此 import
 *   2. 配置 mcpServers 数组，框架自动加载
 *   3. 运行时 /install 命令动态添加（需 allowDynamicInstall: true）
 */

import './library'
import './web'
import './search'
import './codelife'
import './vow'
import './skills'
import './mcp-install'
import './shell'
import './memory-read'
import './memory-write'
import './files'

// ── 从 config 加载 MCP servers（模块初始化时执行，幂等） ─────────
import config from '../../../../codelife.config'
import { loadMCPServers } from '../mcp-loader'

if (config.spirit?.mcpServers?.length) {
  // 异步加载，不阻塞工具注册（失败单个不影响内置工具）
  loadMCPServers(config.spirit.mcpServers).catch(err =>
    console.error('[MCP] 批量加载失败:', err)
  )
}

// 重新导出注册表公共 API，调用方只需 import 这一个文件
export {
  registerTool,
  registerMCPAdapter,
  getToolDefinitions,
  getToolDisplayName,
  callToolsParallel,
} from '../registry'

export type { ToolDefinition, ToolResult, MCPAdapter } from '../registry'
