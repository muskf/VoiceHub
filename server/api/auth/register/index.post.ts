import bcrypt from 'bcryptjs'
import { db, users } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'
import { getBeijingTime } from '~/utils/timeUtils'
import { validateOAuthRegisterCredentials } from '~/utils/oauth-register'
import { isSecureRequest } from '~~/server/utils/request-utils'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkRateLimit } from '~~/server/utils/rateLimiter'

export default defineEventHandler(async (event) => {
  // 检查是否允许邮箱注册
  const config = await db.query.systemSettings.findFirst()
  if (!config?.allowEmailRegistration) {
    throw createError({ statusCode: 403, message: '系统已关闭邮箱注册功能' })
  }

  const clientIP = getClientIP(event)

  // IP 级别限流
  const rateLimitKey = `register_ip:${clientIP}`
  const limitResult = checkRateLimit(rateLimitKey, 10, 60 * 60 * 1000)
  if (!limitResult.isAllowed) {
    const waitMinutes = Math.ceil((limitResult.resetTime - Date.now()) / 60000)
    throw createError({ statusCode: 429, message: `注册操作过于频繁，请等待 ${waitMinutes} 分钟后再试` })
  }

  const body = await readBody(event)
  const { password, confirmPassword, code } = body
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  // 基本校验
  if (!email || !username || !name || !password || !confirmPassword || !code) {
    throw createError({ statusCode: 400, message: '所有字段均为必填项' })
  }

  // 邮箱格式校验
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    throw createError({ statusCode: 400, message: '请输入有效的邮箱地址' })
  }

  // 凭据校验（复用 OAuth 注册的校验逻辑）
  const validationError = validateOAuthRegisterCredentials(username, password, confirmPassword)
  if (validationError) {
    throw createError({ statusCode: 400, message: validationError })
  }

  // 验证邮箱验证码
  const { getStore, delStore } = await import('~~/server/utils/captchaStore')
  const storedData = await getStore(`register_code:${email}`)
  if (!storedData) {
    throw createError({ statusCode: 400, message: '验证码已过期或不存在，请重新获取' })
  }

  let storedCode: { code: string; expiresAt: number }
  try {
    storedCode = JSON.parse(storedData)
  } catch {
    throw createError({ statusCode: 400, message: '验证码数据异常，请重新获取' })
  }

  if (Date.now() > storedCode.expiresAt) {
    await delStore(`register_code:${email}`)
    throw createError({ statusCode: 400, message: '验证码已过期，请重新获取' })
  }

  if (storedCode.code !== code.toString().trim()) {
    throw createError({ statusCode: 400, message: '验证码错误' })
  }

  // 验证通过，删除验证码
  await delStore(`register_code:${email}`)

  // 检查邮箱是否已被使用
  const existingEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existingEmail.length > 0) {
    throw createError({ statusCode: 409, message: '该邮箱已被注册' })
  }

  // 检查用户名是否已存在
  const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)
  if (existingUser.length > 0) {
    throw createError({ statusCode: 409, message: '用户名已存在，请使用其他用户名' })
  }

  try {
    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10)
    const now = getBeijingTime()

    // 创建用户
    const insertedUser = (await db
      .insert(users)
      .values({
        username,
        name,
        password: hashedPassword,
        email,
        emailVerified: true,
        role: 'USER',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        passwordChangedAt: now,
        lastLogin: now,
        lastLoginIp: clientIP,
        forcePasswordChange: false
      })
      .returning({ id: users.id }))[0]

    if (!insertedUser) {
      throw new Error('Failed to create user')
    }

    // 生成 JWT 令牌，自动登录
    const token = JWTEnhanced.generateToken(insertedUser.id, 'USER')
    const isSecure = isSecureRequest(event)

    setCookie(event, 'auth-token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    })

    return {
      success: true,
      user: {
        id: insertedUser.id,
        username,
        role: 'USER'
      }
    }
  } catch (e: any) {
    console.error('[Register] 注册失败:', e)
    throw createError({
      statusCode: e.statusCode || 500,
      message: e.message || '注册失败，请稍后重试'
    })
  }
})
