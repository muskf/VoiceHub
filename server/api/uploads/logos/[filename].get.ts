import { promises as fs } from 'fs'
import path from 'path'
import { createError } from 'h3'

// 生产环境下上传文件存储在独立目录，通过此端点提供访问
export default defineEventHandler(async (event) => {
  const filename = getRouterParam(event, 'filename')

  if (!filename) {
    throw createError({ statusCode: 400, message: 'Missing filename' })
  }

  // 安全：仅允许 basename，防止路径遍历
  const safeName = path.basename(filename)
  if (safeName !== filename || safeName.includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid filename' })
  }

  // 仅允许图片扩展名
  const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'])
  const ext = path.extname(safeName).toLowerCase()
  if (!allowedExts.has(ext)) {
    throw createError({ statusCode: 400, message: 'Invalid file type' })
  }

  // 优先从存储目录读取（持久化路径），回退到 public 目录
  const storagePath = path.join(process.cwd(), 'uploads', 'logos', safeName)
  const publicPath = path.join(process.cwd(), 'public', 'uploads', 'logos', safeName)

  let filepath = storagePath
  try {
    await fs.access(storagePath)
  } catch {
    filepath = publicPath
    try {
      await fs.access(publicPath)
    } catch {
      throw createError({ statusCode: 404, message: 'File not found' })
    }
  }

  // 安全检查：确保解析后路径在允许目录内
  const resolved = path.resolve(filepath)
  const allowedDir1 = path.resolve(path.join(process.cwd(), 'uploads', 'logos'))
  const allowedDir2 = path.resolve(path.join(process.cwd(), 'public', 'uploads', 'logos'))
  if (!resolved.startsWith(allowedDir1 + path.sep) && !resolved.startsWith(allowedDir2 + path.sep)) {
    throw createError({ statusCode: 400, message: 'Invalid path' })
  }

  const fileBuffer = await fs.readFile(filepath)

  // 设置 Content-Type
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  }

  setHeader(event, 'Content-Type', mimeTypes[ext] || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'public, max-age=86400')

  return new Uint8Array(fileBuffer)
})
