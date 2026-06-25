import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkRateLimit } from '~~/server/utils/rateLimiter'
import { sendPnvsSmsCode } from '~~/server/services/smsService'
import { verifyAndConsumeCaptcha } from '~~/server/utils/captcha'

export default defineEventHandler(async (event) => {
  const config = await db.query.systemSettings.findFirst()
  if (!config?.allowPhoneRegistration) {
    throw createError({ statusCode: 403, message: '系统已关闭手机号注册功能' })
  }
  if (!config?.smsEnabled) {
    throw createError({ statusCode: 503, message: '短信服务未配置' })
  }

  const clientIP = getClientIP(event)

  // ===== 防盗刷多层限流 =====

  // 1. 全局限流
  const globalLimit = checkRateLimit('phone_code_global', 20, 60 * 1000)
  if (!globalLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '系统短信发送量过大，请稍后再试' })
  }

  // 2. IP 限流
  const ipHourLimit = checkRateLimit(`phone_code_ip_h:${clientIP}`, 5, 60 * 60 * 1000)
  if (!ipHourLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '操作过于频繁，请稍后再试' })
  }
  const ipDayLimit = checkRateLimit(`phone_code_ip_d:${clientIP}`, 15, 24 * 60 * 60 * 1000)
  if (!ipDayLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '今日操作次数已达上限' })
  }

  const body = await readBody(event)
  const phone = (body?.phone || '').toString().trim()

  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '请输入有效的手机号码' })
  }

  // 3. 手机号限流
  const phoneHourLimit = checkRateLimit(`phone_code_p_h:${phone}`, 2, 60 * 60 * 1000)
  if (!phoneHourLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '该手机号发送验证码过于频繁' })
  }
  const phoneDayLimit = checkRateLimit(`phone_code_p_d:${phone}`, 5, 24 * 60 * 60 * 1000)
  if (!phoneDayLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '该手机号今日验证码次数已达上限' })
  }

  // 4. CAPTCHA 验证码校验（系统启用时必须提供）
  if (config?.captchaEnabled) {
    const captchaId = (body?.captchaId || '').toString()
    const captchaInput = (body?.captchaInput || '').toString()
    if (!captchaId || !captchaInput) {
      throw createError({ statusCode: 400, message: '请完成图形验证码验证' })
    }
    const captchaValid = await verifyAndConsumeCaptcha(captchaId, captchaInput)
    if (!captchaValid) {
      throw createError({ statusCode: 400, message: '图形验证码错误，请重试' })
    }
  }

  // 5. 通过阿里云号码认证服务发送验证码
  const result = await sendPnvsSmsCode(phone, {
    accessKeyId: config.smsAliyunAccessKeyId || '',
    accessKeySecret: config.smsAliyunAccessKeySecret || ''
  })

  if (!result.success) {
    console.error(`[Phone] 短信发送失败: ${phone} - ${result.message}`)
  }

  // 无论成功失败都返回相同响应
  return { success: true, message: '验证码已发送，请查收短信' }
})
