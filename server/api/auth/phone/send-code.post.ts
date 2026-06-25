import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkRateLimit } from '~~/server/utils/rateLimiter'
import { sendAliyunSms } from '~~/server/services/smsService'
import { randomInt } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const config = await db.query.systemSettings.findFirst()
  if (!config?.allowPhoneRegistration) {
    throw createError({ statusCode: 403, message: '系统已关闭手机号注册功能' })
  }
  if (!config?.smsEnabled) {
    throw createError({ statusCode: 503, message: '短信服务未配置' })
  }

  const clientIP = getClientIP(event)

  // IP 限流
  const ipLimit = checkRateLimit(`phone_code_ip:${clientIP}`, 5, 60 * 60 * 1000)
  if (!ipLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '操作过于频繁，请稍后再试' })
  }

  const body = await readBody(event)
  const phone = (body?.phone || '').toString().trim()

  // 中国大陆手机号校验
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '请输入有效的手机号码' })
  }

  // 手机号限流
  const phoneLimit = checkRateLimit(`phone_code:${phone}`, 3, 60 * 60 * 1000)
  if (!phoneLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '该手机号发送验证码过于频繁' })
  }

  // 生成 6 位验证码
  const code = randomInt(100000, 999999).toString()

  // 存储验证码
  const { setStore } = await import('~~/server/utils/captchaStore')
  await setStore(`phone_code:${phone}`, JSON.stringify({ code, expiresAt: Date.now() + 5 * 60 * 1000 }), 5 * 60)

  // 发送短信
  const sent = await sendAliyunSms(phone, { code }, {
    accessKeyId: config.smsAliyunAccessKeyId || '',
    accessKeySecret: config.smsAliyunAccessKeySecret || '',
    signName: config.smsAliyunSignName || '',
    templateCode: config.smsAliyunTemplateCode || ''
  })

  if (!sent) {
    console.error(`[Phone] 短信发送失败: ${phone}`)
  }

  // 无论成功失败都返回相同响应（防止手机号枚举）
  return { success: true, message: '验证码已发送，请查收短信' }
})
