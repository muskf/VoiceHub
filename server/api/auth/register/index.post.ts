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

  // ===== 防滥用多层限流 =====

  // 1. IP 限流：每小时 10 次 + 每天 30 次
  const ipHourLimit = checkRateLimit(`register_ip_h:${clientIP}`, 10, 60 * 60 * 1000)
  if (!ipHourLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '注册操作过于频繁，请稍后再试' })
  }
  const ipDayLimit = checkRateLimit(`register_ip_d:${clientIP}`, 30, 24 * 60 * 60 * 1000)
  if (!ipDayLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '今日注册次数已达上限' })
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

  // 2. 邮箱限流：每小时 5 次
  const emailHourLimit = checkRateLimit(`register_email_h:${email}`, 5, 60 * 60 * 1000)
  if (!emailHourLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '该邮箱注册尝试过于频繁' })
  }

  // 3. 检查是否被锁定（连续 5 次验证码错误锁定 10 分钟）
  const { getAndDelStore, setStore, getStore, incrStore, delStore } = await import('~~/server/utils/captchaStore')
  const lockKey = `register_lock:${email}`
  const isLocked = await getStore(lockKey)
  if (isLocked) {
    throw createError({ statusCode: 429, message: '该邮箱已被临时锁定，请10分钟后再试' })
  }

  // 验证邮箱验证码（原子操作：获取并删除，防止竞态条件）
  const storedData = await getAndDelStore(`register_code:${email}`)
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
    throw createError({ statusCode: 400, message: '验证码已过期，请重新获取' })
  }

  // 时序安全的验证码比较
  const { timingSafeEqual } = await import('node:crypto')
  const storedBuf = Buffer.from(storedCode.code, 'utf8')
  const inputBuf = Buffer.from(code.toString().trim(), 'utf8')
  if (storedBuf.length !== inputBuf.length || !timingSafeEqual(storedBuf, inputBuf)) {
    // 验证失败时恢复验证码（允许重试）
    const remainingMs = storedCode.expiresAt - Date.now()
    if (remainingMs > 0) {
      await setStore(`register_code:${email}`, storedData, Math.ceil(remainingMs / 1000))
    }

    // 递增失败计数
    const failKey = `register_fail:${email}`
    const failCount = await incrStore(failKey, 10 * 60)

    // 连续 5 次失败 → 锁定 10 分钟
    if (failCount >= 5) {
      await setStore(lockKey, '1', 10 * 60)
      await delStore(failKey)
      console.warn(`[Register] 邮箱 ${email} 连续验证失败 ${failCount} 次，已锁定 (IP: ${clientIP})`)
      throw createError({ statusCode: 429, message: '验证码错误次数过多，该邮箱已被临时锁定10分钟' })
    }

    throw createError({ statusCode: 400, message: '验证码错误' })
  }

  // 验证成功 — 清除失败计数
  await delStore(`register_fail:${email}`)

  // 检查邮箱是否已被使用
  const existingEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existingEmail.length > 0) {
    throw createError({ statusCode: 409, message: '该邮箱已被注册' })
  }

  // 检查保留用户名
  const RESERVED_USERNAMES = new Set([
    'admin', 'administrator', 'root', 'system', 'moderator', 'superadmin',
    'super_admin', 'song_admin', 'null', 'undefined', 'api', 'www', 'mail'
  ])
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    throw createError({ statusCode: 400, message: '该用户名为系统保留，请选择其他用户名' })
  }

  // 检查用户名是否已存在
  const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)
  if (existingUser.length > 0) {
    throw createError({ statusCode: 409, message: '用户名已存在，请使用其他用户名' })
  }

  try {
    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 12)
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
      message: e.statusCode ? e.message : '注册失败，请稍后重试'
    })
  }
})
