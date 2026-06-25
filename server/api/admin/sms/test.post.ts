import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { sendPnvsSmsCode } from '~~/server/services/smsService'
import { checkRateLimit } from '~~/server/utils/rateLimiter'
import { getClientIP } from '~~/server/utils/ip-utils'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== 'SUPER_ADMIN') {
    throw createError({ statusCode: 403, message: '只有超级管理员可以测试短信' })
  }

  const clientIP = getClientIP(event)
  const limit = checkRateLimit(`sms_test:${user.id}`, 3, 60 * 60 * 1000)
  if (!limit.isAllowed) {
    throw createError({ statusCode: 429, message: '测试过于频繁' })
  }

  const config = await db.query.systemSettings.findFirst()
  if (!config?.smsEnabled) {
    throw createError({ statusCode: 400, message: '短信服务未启用' })
  }
  if (!config.smsAliyunAccessKeyId || !config.smsAliyunAccessKeySecret) {
    throw createError({ statusCode: 400, message: '阿里云 AccessKey 未配置' })
  }

  const body = await readBody(event)
  const phone = (body?.phone || '').toString().trim()

  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '请输入有效的手机号码' })
  }

  console.log(`[SMS Test] 管理员 ${user.username} 测试 PNVS 短信发送至 ${phone}`)

  const result = await sendPnvsSmsCode(phone, {
    accessKeyId: config.smsAliyunAccessKeyId,
    accessKeySecret: config.smsAliyunAccessKeySecret
  })

  if (result.success) {
    return { success: true, message: `测试短信已发送至 ${phone}` }
  } else {
    throw createError({ statusCode: 500, message: `短信发送失败: ${result.message}` })
  }
})
