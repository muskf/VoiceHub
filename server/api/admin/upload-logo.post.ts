import { createError, defineEventHandler } from 'h3'
import { promises as fs } from 'fs'
import path from 'path'
import formidable from 'formidable'

const ALLOWED_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon'
]

const ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

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

  // 解析上传的文件
  const form = formidable({
    uploadDir,
    keepExtensions: true,
    maxFileSize: MAX_FILE_SIZE,
    filter: ({ mimetype, originalFilename }) => {
      const ext = originalFilename ? path.extname(originalFilename).toLowerCase() : ''
      return (mimetype && ALLOWED_MIMES.includes(mimetype)) || (ext && ALLOWED_EXTS.includes(ext))
    }
  })

  let fields, files
  try {
    ;[fields, files] = await form.parse(event.node.req)
  } catch (e: any) {
    if (e.code === 'ERROR_LIMIT_FILE_SIZE') {
      throw createError({ statusCode: 400, message: '文件大小不能超过 5MB' })
    }
    throw createError({ statusCode: 400, message: '文件解析失败' })
  }

  const logoType = (fields.type?.[0] || 'site').toString()
  if (!['site', 'school-home', 'school-print'].includes(logoType)) {
    throw createError({ statusCode: 400, message: '无效的 Logo 类型' })
  }

  if (!files.file || !files.file[0]) {
    throw createError({ statusCode: 400, message: '请选择要上传的图片' })
  }

  const uploadedFile = files.file[0]
  const ext = path.extname(uploadedFile.originalFilename || '.png').toLowerCase()

  if (!ALLOWED_EXTS.includes(ext)) {
    await fs.unlink(uploadedFile.filepath).catch(() => {})
    throw createError({ statusCode: 400, message: `不支持的文件格式: ${ext}，仅支持 ${ALLOWED_EXTS.join(', ')}` })
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
