import { createError, defineEventHandler } from 'h3'
import { promises as fs } from 'fs'
import path from 'path'
import formidable from 'formidable'

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon'
])

const ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'])

// Magic bytes for image type validation
const MAGIC_BYTES: Record<string, number[][]> = {
  '.png': [[0x89, 0x50, 0x4E, 0x47]],
  '.jpg': [[0xFF, 0xD8, 0xFF]],
  '.jpeg': [[0xFF, 0xD8, 0xFF]],
  '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header
  '.ico': [[0x00, 0x00, 0x01, 0x00]]
}

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

async function validateMagicBytes(filepath: string, ext: string): Promise<boolean> {
  const patterns = MAGIC_BYTES[ext]
  if (!patterns) return true // No pattern to check
  try {
    const fd = await fs.open(filepath, 'r')
    const buf = Buffer.alloc(8)
    await fd.read(buf, 0, 8, 0)
    await fd.close()
    return patterns.some(pattern =>
      pattern.every((byte, i) => buf[i] === byte)
    )
  } catch {
    return false
  }
}

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '只有管理员可以上传 Logo' })
  }

  // 创建上传目录
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'logos')
  try {
    await fs.access(uploadDir)
  } catch {
    await fs.mkdir(uploadDir, { recursive: true })
  }

  // 解析上传的文件 — 要求 MIME 和扩展名同时合法
  const form = formidable({
    uploadDir,
    keepExtensions: true,
    maxFileSize: MAX_FILE_SIZE,
    filter: ({ mimetype, originalFilename }) => {
      const ext = originalFilename ? path.extname(originalFilename).toLowerCase() : ''
      const mimeOk = !!mimetype && ALLOWED_MIMES.has(mimetype)
      const extOk = !!ext && ALLOWED_EXTS.has(ext)
      return mimeOk && extOk
    }
  })

  let fields, files
  try {
    ;[fields, files] = await form.parse(event.node.req)
  } catch (e: any) {
    if (e.code === 'ERROR_LIMIT_FILE_SIZE') {
      throw createError({ statusCode: 400, message: '文件大小不能超过 5MB' })
    }
    throw createError({ statusCode: 400, message: '文件解析失败，请确保上传的是有效图片文件' })
  }

  const logoType = (fields.type?.[0] || 'site').toString()
  if (!['site', 'school-home', 'school-print'].includes(logoType)) {
    throw createError({ statusCode: 400, message: '无效的 Logo 类型' })
  }

  if (!files.file || !files.file[0]) {
    throw createError({ statusCode: 400, message: '请选择要上传的图片（仅支持 PNG/JPG/GIF/WebP/ICO）' })
  }

  const uploadedFile = files.file[0]
  const ext = path.extname(uploadedFile.originalFilename || '.png').toLowerCase()

  if (!ALLOWED_EXTS.has(ext)) {
    await fs.unlink(uploadedFile.filepath).catch(() => {})
    throw createError({ statusCode: 400, message: `不支持的文件格式: ${ext}，仅支持 ${[...ALLOWED_EXTS].join(', ')}` })
  }

  // Magic byte 校验：确保文件内容与扩展名匹配
  if (!(await validateMagicBytes(uploadedFile.filepath, ext))) {
    await fs.unlink(uploadedFile.filepath).catch(() => {})
    throw createError({ statusCode: 400, message: '文件内容与扩展名不匹配，请上传有效的图片文件' })
  }

  // 生成安全的文件名
  const timestamp = Date.now()
  const newFilename = `${logoType}-${timestamp}${ext}`
  const newFilepath = path.join(uploadDir, newFilename)

  // 移动文件
  await fs.rename(uploadedFile.filepath, newFilepath)

  // 返回 URL 路径
  const urlPath = `/uploads/logos/${newFilename}`

  console.log(`[Logo] 管理员 ${user.username} 上传了 ${logoType} Logo: ${newFilename}`)

  return {
    success: true,
    url: urlPath,
    filename: newFilename
  }
})
