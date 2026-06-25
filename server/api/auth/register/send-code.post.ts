import { db } from '~/drizzle/db'
import { users, systemSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { SmtpService } from '~~/server/services/smtpService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkRateLimit } from '~~/server/utils/rateLimiter'
import { randomInt } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const config = await db.query.systemSettings.findFirst()
  if (!config?.allowEmailRegistration) {
    throw createError({ statusCode: 403, message: '系统已关闭邮箱注册功能' })
  }
  if (!config?.smtpEnabled) {
    throw createError({ statusCode: 503, message: '邮件服务未配置，无法发送验证码' })
  }

  const clientIP = getClientIP(event)

  // ===== 防滥用多层限流 =====

  // 1. 全局限流：每分钟 30 封
  const globalLimit = checkRateLimit('email_code_global', 30, 60 * 1000)
  if (!globalLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '系统邮件发送量过大，请稍后再试' })
  }

  // 2. IP 限流：每小时 5 次 + 每天 15 次
  const ipHourLimit = checkRateLimit(`email_code_ip_h:${clientIP}`, 5, 60 * 60 * 1000)
  if (!ipHourLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '操作过于频繁，请稍后再试' })
  }
  const ipDayLimit = checkRateLimit(`email_code_ip_d:${clientIP}`, 15, 24 * 60 * 60 * 1000)
  if (!ipDayLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '今日操作次数已达上限，请明天再试' })
  }

  const body = await readBody(event)
  const emailRaw = (body?.email || '').toString().trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRaw || !emailRegex.test(emailRaw)) {
    throw createError({ statusCode: 400, message: '请输入有效的邮箱地址' })
  }

  // 3. 邮箱限流：每小时 2 次 + 每天 5 次
  const emailHourLimit = checkRateLimit(`email_code_e_h:${emailRaw}`, 2, 60 * 60 * 1000)
  if (!emailHourLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '该邮箱发送验证码过于频繁，请稍后再试' })
  }
  const emailDayLimit = checkRateLimit(`email_code_e_d:${emailRaw}`, 5, 24 * 60 * 60 * 1000)
  if (!emailDayLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '该邮箱今日验证码次数已达上限' })
  }

  // 4. 检查邮箱是否已被使用（静默返回，防止邮箱枚举）
  const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, emailRaw)).limit(1)
  if (existingUser.length > 0) {
    // 生成虚拟验证码以均衡响应时间（防止时序侧信道）
    randomInt(100000, 999999)
    return { success: true, message: '验证码已发送，请查收邮箱' }
  }

  // 5. 密码学安全验证码
  const code = randomInt(100000, 999999).toString()
  const expiresAt = Date.now() + 5 * 60 * 1000

  const { setStore } = await import('~~/server/utils/captchaStore')
  await setStore(`register_code:${emailRaw}`, JSON.stringify({ code, expiresAt }), 5 * 60)

  // 6. 发送验证码邮件
  try {
    const smtp = SmtpService.getInstance()
    await smtp.initializeSmtpConfig()
    const sent = await smtp.renderAndSend(
      emailRaw,
      'verification.code',
      { name: '新用户', email: emailRaw, code, expiresInMinutes: 5 },
      clientIP
    )
    if (!sent) {
      console.error(`[Register] 验证码邮件发送失败 IP: ${clientIP}`)
    }
  } catch (e: any) {
    console.error('[Register] 发送验证码邮件失败:', e.message)
  }

  // 无论成功失败都返回相同响应
  return { success: true, message: '验证码已发送，请查收邮箱' }
})
