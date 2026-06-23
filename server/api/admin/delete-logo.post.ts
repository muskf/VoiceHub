import { promises as fs } from 'fs'
import path from 'path'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '只有管理员可以删除 Logo' })
  }

  const body = await readBody(event)
  const url = typeof body?.url === 'string' ? body.url.trim() : ''

  if (!url) {
    throw createError({ statusCode: 400, message: '请提供要删除的 Logo URL' })
  }

  // 安全检查：确保路径在 uploads/logos/ 目录下
  if (!url.startsWith('/uploads/logos/')) {
    throw createError({ statusCode: 400, message: '只能删除 uploads/logos 目录下的文件' })
  }

  // 防止路径遍历
  const filename = path.basename(url)
  const filepath = path.join(process.cwd(), 'public', 'uploads', 'logos', filename)

  // 二次验证路径
  const resolved = path.resolve(filepath)
  const allowedDir = path.resolve(path.join(process.cwd(), 'public', 'uploads', 'logos'))
  if (!resolved.startsWith(allowedDir + path.sep) && resolved !== allowedDir) {
    throw createError({ statusCode: 400, message: '非法路径' })
  }

  try {
    // 检查是否为符号链接（防止 symlink 攻击）
    const stat = await fs.lstat(filepath)
    if (stat.isSymbolicLink()) {
      throw createError({ statusCode: 400, message: '不允许删除符号链接' })
    }

    await fs.unlink(filepath)
    console.log(`[Logo] 管理员 ${user.username} 删除了 Logo: ${filename}`)
    return { success: true, message: 'Logo 已删除' }
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw createError({ statusCode: 404, message: '文件不存在' })
    }
    console.error('[Logo] 删除失败:', e)
    throw createError({ statusCode: 500, message: '删除失败' })
  }
})
