import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { SmtpService } from '~~/server/services/smtpService'
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkRateLimit } from '~~/server/utils/rateLimiter'

export default defineEventHandler(async (event) => {
  const clientIP = getClientIP(event)
  
  // IP 级别限流：每小时最多 5 次请求
  const rateLimitKey = `forgot_password_ip:${clientIP}`
  const limitResult = checkRateLimit(rateLimitKey, 5, 60 * 60 * 1000)
  
  if (!limitResult.isAllowed) {
    const waitMinutes = Math.ceil((limitResult.resetTime - Date.now()) / 60000)
    throw createError({ 
      statusCode: 429, 
      message: `操作过于频繁，请等待 ${waitMinutes} 分钟后再试` 
    })
  }

  const body = await readBody(event)
  const { username, email } = body

  if (!username) {
    throw createError({ statusCode: 400, message: '请提供账号名' })
  }

  try {
    const userResult = await db.select().from(users).where(eq(users.username, username)).limit(1)
    const user = userResult[0]

    // 如果未提供邮箱，则进入第一步：检查账号并返回掩码邮箱
    if (!email) {
      if (!user) {
        // 使用通用响应，防止用户名枚举
        return {
          success: true,
          step: 2,
          maskedEmail: '',
          message: '如果账号存在且绑定了邮箱，验证信息将发送到您的邮箱'
        }
      }
      if (!user.email) {
        return {
          success: true,
          step: 2,
          maskedEmail: '',
          message: '如果账号存在且绑定了邮箱，验证信息将发送到您的邮箱'
        }
      }
      
      // 生成掩码邮箱 (例如: a***b@gmail.com)
      const emailParts = user.email.split('@')
      const name = emailParts[0]
      const domain = emailParts[1]
      let maskedName = name
      if (name && name.length > 2) {
        maskedName = name.substring(0, 1) + '***' + name.substring(name.length - 1)
      } else if (name && name.length === 2) {
        maskedName = name.substring(0, 1) + '*'
      }
      const maskedEmail = `${maskedName}@${domain}`
      
      return { 
        success: true, 
        step: 2,
        maskedEmail,
        message: '请输入完整的邮箱地址以验证身份' 
      }
    }

    // 无论是否匹配，都返回相同的成功提示
    if (user && user.email && user.email.toLowerCase() === email.toLowerCase()) {
      // 使用随机令牌替代部分密码哈希，避免泄露密码信息
      const { randomBytes } = await import('node:crypto')
      const resetNonce = randomBytes(32).toString('hex')

      // 将令牌存入 captchaStore（5 分钟过期）
      const { setStore } = await import('~~/server/utils/captchaStore')
      await setStore(`password_reset:${user.id}`, JSON.stringify({
        nonce: resetNonce,
        userId: user.id,
        expiresAt: Date.now() + 15 * 60 * 1000
      }), 15 * 60)

      const payload = {
        type: 'password_reset',
        userId: user.id,
        nonce: resetNonce.substring(0, 16) // 仅放前16位到JWT中
      }
      const token = JWTEnhanced.sign(payload, { expiresIn: '15m' })

      // 修复 Host Header Injection 风险，优先使用环境变量中配置的主机名
      const config = useRuntimeConfig()
      let resetLink = ''
      
      if (config.public.host) {
        // 如果配置了主机名，则直接使用
        const protocol = config.public.host.startsWith('http') ? '' : (process.env.NODE_ENV === 'production' ? 'https://' : 'http://')
        resetLink = `${protocol}${config.public.host}/reset-password?token=${token}`
      } else {
        // 降级回退：使用安全的请求头获取方式
        const host = getRequestHost(event)
        const finalProtocol = getRequestProtocol(event)
        resetLink = `${finalProtocol}://${host}/reset-password?token=${token}`
      }

      const smtp = SmtpService.getInstance()
      
      // 确保SMTP配置已初始化
      await smtp.initializeSmtpConfig()

      const htmlContent = smtp.generateEmailTemplate(
        '重置密码',
        `<p>您好，您请求了重置密码。</p><p>请点击下方按钮重置密码（链接在15分钟内有效）。</p><p style="color:#888">如果您没有请求重置密码，请忽略此邮件。</p>`,
        resetLink,
        clientIP
      )

      event.waitUntil(
        smtp.sendMail(user.email, '重置密码 | VoiceHub', htmlContent, undefined, clientIP)
          .catch(err => console.error('发送重置密码邮件失败:', err))
      )
    }

    return { 
      success: true, 
      step: 3,
      message: '如果账号名和邮箱匹配，重置密码链接已发送至您的邮箱。请查收并按照邮件中的说明重置密码。' 
    }
  } catch (error: any) {
    if (error.statusCode) {
      throw error
    }
    console.error('重置密码请求失败:', error)
    throw createError({
      statusCode: 500,
      message: '系统错误，请稍后重试'
    })
  }
})
