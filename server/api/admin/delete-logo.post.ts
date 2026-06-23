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

  // 安全检查：支持两种 URL 格式
  if (!url.startsWith('/uploads/logos/') && !url.startsWith('/api/uploads/logos/')) {
    throw createError({ statusCode: 400, message: '只能删除 uploads/logos 目录下的文件' })
  }

  // 防止路径遍历
  const filename = path.basename(url)
  const publicFilepath = path.join(process.cwd(), 'public', 'uploads', 'logos', filename)
  const storageFilepath = path.join(process.cwd(), 'uploads', 'logos', filename)

  // 路径安全验证
  const resolvedPublic = path.resolve(publicFilepath)
  const resolvedStorage = path.resolve(storageFilepath)
  const allowedPublicDir = path.resolve(path.join(process.cwd(), 'public', 'uploads', 'logos'))
  const allowedStorageDir = path.resolve(path.join(process.cwd(), 'uploads', 'logos'))

  if (!resolvedPublic.startsWith(allowedPublicDir + path.sep) &&
      !resolvedStorage.startsWith(allowedStorageDir + path.sep)) {
    throw createError({ statusCode: 400, message: '非法路径' })
  }

  let deleted = false

  // 从两个位置删除
  for (const filepath of [publicFilepath, storageFilepath]) {
    try {
      const stat = await fs.lstat(filepath)
      if (stat.isSymbolicLink()) {
        throw createError({ statusCode: 400, message: '不允许删除符号链接' })
      }
      await fs.unlink(filepath)
      deleted = true
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e
    }
  }

  if (!deleted) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  console.log(`[Logo] 管理员 ${user.username} 删除了 Logo: ${filename}`)
  return { success: true, message: 'Logo 已删除' }
})
