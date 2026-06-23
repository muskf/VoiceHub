import { db } from '~/drizzle/db'
import { users, systemSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { SmtpService } from '~~/server/services/smtpService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkRateLimit } from '~~/server/utils/rateLimiter'
import { randomInt } from 'node:crypto'

export default defineEventHandler(async (event) => {
  // 检查是否允许邮箱注册
  const config = await db.query.systemSettings.findFirst()
  if (!config?.allowEmailRegistration) {
    throw createError({ statusCode: 403, message: '系统已关闭邮箱注册功能' })
  }

  // 检查 SMTP 是否配置
  if (!config?.smtpEnabled) {
    throw createError({ statusCode: 503, message: '邮件服务未配置，无法发送验证码' })
  }

  const clientIP = getClientIP(event)

  // IP 级别限流：每小时最多 5 次
  const ipRateLimitKey = `register_send_code_ip:${clientIP}`
  const ipLimitResult = checkRateLimit(ipRateLimitKey, 5, 60 * 60 * 1000)
  if (!ipLimitResult.isAllowed) {
    const waitMinutes = Math.ceil((ipLimitResult.resetTime - Date.now()) / 60000)
    throw createError({ statusCode: 429, message: `操作过于频繁，请等待 ${waitMinutes} 分钟后再试` })
  }

  const body = await readBody(event)
  const emailRaw = (body?.email || '').toString().trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRaw || !emailRegex.test(emailRaw)) {
    throw createError({ statusCode: 400, message: '请输入有效的邮箱地址' })
  }

  // 邮箱级别限流：每小时最多 3 次
  const emailRateLimitKey = `register_send_code_email:${emailRaw}`
  const emailLimitResult = checkRateLimit(emailRateLimitKey, 3, 60 * 60 * 1000)
  if (!emailLimitResult.isAllowed) {
    throw createError({ statusCode: 429, message: '发送验证码过于频繁，请稍后再试' })
  }

  // 检查邮箱是否已被使用（但不对外暴露结果，防止邮箱枚举）
  const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, emailRaw)).limit(1)
  if (existingUser.length > 0) {
    // 静默返回成功，不发送验证码，防止邮箱枚举攻击
    return { success: true, message: '验证码已发送，请查收邮箱' }
  }

  // 使用 crypto.randomInt 生成密码学安全的 6 位验证码
  const code = randomInt(100000, 999999).toString()
  const expiresAt = Date.now() + 5 * 60 * 1000

  // 存入存储（captchaStore，支持 Redis/内存）
  const { setStore } = await import('~~/server/utils/captchaStore')
  await setStore(`register_code:${emailRaw}`, JSON.stringify({ code, expiresAt }), 5 * 60)

  // 发送验证码邮件
  try {
    const smtp = SmtpService.getInstance()
    await smtp.initializeSmtpConfig()
    const sent = await smtp.renderAndSend(
      emailRaw,
      'verification.code',
      {
        name: '新用户',
        email: emailRaw,
        code,
        expiresInMinutes: 5
      },
      clientIP
    )
    if (!sent) {
      console.error('[Register] 验证码邮件发送失败')
    }
  } catch (e: any) {
    console.error('[Register] 发送验证码邮件失败:', e.message)
  }

  // 无论发送是否成功，都返回相同响应（防止信息泄露）
  return { success: true, message: '验证码已发送，请查收邮箱' }
})
