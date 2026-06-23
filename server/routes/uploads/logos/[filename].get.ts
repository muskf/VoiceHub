import { promises as fs } from 'fs'
import path from 'path'

// 通过 server route 提供 /uploads/logos/* 静态文件服务
// 解决 Nuxt 生产构建中 public/ 目录文件不可用的问题
export default defineEventHandler(async (event) => {
  const filename = getRouterParam(event, 'filename')
  if (!filename) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  // 安全：仅允许 basename
  const safeName = path.basename(filename)
  if (safeName !== filename || safeName.includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid filename' })
  }

  // 仅允许图片扩展名
  const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg'])
  const ext = path.extname(safeName).toLowerCase()
  if (!allowedExts.has(ext)) {
    throw createError({ statusCode: 400, message: 'Invalid file type' })
  }

  // 从持久化存储和 public 目录查找
  const candidates = [
    path.join(process.cwd(), 'uploads', 'logos', safeName),
    path.join(process.cwd(), 'public', 'uploads', 'logos', safeName)
  ]

  let filepath: string | null = null
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      filepath = candidate
      break
    } catch { /* continue */ }
  }

  if (!filepath) {
    throw createError({ statusCode: 404, message: 'Logo not found' })
  }

  // 安全检查
  const resolved = path.resolve(filepath)
  const allowedDirs = [
    path.resolve(path.join(process.cwd(), 'uploads', 'logos')),
    path.resolve(path.join(process.cwd(), 'public', 'uploads', 'logos'))
  ]
  if (!allowedDirs.some(dir => resolved.startsWith(dir + path.sep))) {
    throw createError({ statusCode: 400, message: 'Invalid path' })
  }

  const fileBuffer = await fs.readFile(filepath)

  const mimeTypes: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml'
  }

  setHeader(event, 'Content-Type', mimeTypes[ext] || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'public, max-age=86400')

  return new Uint8Array(fileBuffer)
})
