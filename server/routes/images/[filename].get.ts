import { promises as fs } from 'fs'
import path from 'path'

// 品牌 Logo 覆盖：当管理员上传了品牌 Logo 时，优先使用上传版本
// 映射关系：logo.png → brand-logo.png, logo-144.png → brand-logo-144.png, logo.svg → brand-logo.svg
const BRAND_MAP: Record<string, string> = {
  'logo.png': 'brand-logo.png',
  'logo-144.png': 'brand-logo-144.png',
  'logo.svg': 'brand-logo.svg'
}

export default defineEventHandler(async (event) => {
  const filename = getRouterParam(event, 'filename')
  if (!filename) return

  const safeName = path.basename(filename)
  const brandFilename = BRAND_MAP[safeName]

  // 如果不在品牌映射中，不处理
  if (!brandFilename) return

  // 检查是否有上传的品牌 Logo
  const candidates = [
    path.join(process.cwd(), 'uploads', 'logos', brandFilename),
    path.join(process.cwd(), 'public', 'uploads', 'logos', brandFilename)
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      const resolved = path.resolve(candidate)
      const allowedDirs = [
        path.resolve(path.join(process.cwd(), 'uploads', 'logos')),
        path.resolve(path.join(process.cwd(), 'public', 'uploads', 'logos'))
      ]
      if (!allowedDirs.some(dir => resolved.startsWith(dir + path.sep))) continue

      const fileBuffer = await fs.readFile(candidate)
      const ext = path.extname(safeName).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
      }

      setHeader(event, 'Content-Type', mimeTypes[ext] || 'application/octet-stream')
      setHeader(event, 'Cache-Control', 'public, max-age=3600')
      return new Uint8Array(fileBuffer)
    } catch {
      // continue to next candidate
    }
  }

  // 没有上传版本，不处理（Nuxt 会正常提供 public/images/ 下的默认文件）
})
