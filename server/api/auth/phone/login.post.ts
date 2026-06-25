import bcrypt from 'bcryptjs'
import { db, users } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'
import { getBeijingTime } from '~/utils/timeUtils'
import { isSecureRequest } from '~~/server/utils/request-utils'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkRateLimit } from '~~/server/utils/rateLimiter'
import { timingSafeEqual } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const config = await db.query.systemSettings.findFirst()
  if (!config?.allowPhoneRegistration) {
    throw createError({ statusCode: 403, message: '系统已关闭手机号登录功能' })
  }

  const clientIP = getClientIP(event)
  const rateLimit = checkRateLimit(`phone_login_ip:${clientIP}`, 10, 60 * 1000)
  if (!rateLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '操作过于频繁，请稍后再试' })
  }

  const body = await readBody(event)
  const phone = (body?.phone || '').toString().trim()
  const code = (body?.code || '').toString().trim()

  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '请输入有效的手机号码' })
  }
  if (!/^\d{6}$/.test(code)) {
    throw createError({ statusCode: 400, message: '请输入6位验证码' })
  }

  // 验证码校验（原子操作）
  const { getAndDelStore, setStore } = await import('~~/server/utils/captchaStore')
  const storedData = await getAndDelStore(`phone_code:${phone}`)
  if (!storedData) {
    throw createError({ statusCode: 400, message: '验证码已过期，请重新获取' })
  }

  let storedCode: { code: string; expiresAt: number }
  try {
    storedCode = JSON.parse(storedData)
  } catch {
    throw createError({ statusCode: 400, message: '验证码数据异常' })
  }

  if (Date.now() > storedCode.expiresAt) {
    throw createError({ statusCode: 400, message: '验证码已过期，请重新获取' })
  }

  const storedBuf = Buffer.from(storedCode.code, 'utf8')
  const inputBuf = Buffer.from(code, 'utf8')
  if (storedBuf.length !== inputBuf.length || !timingSafeEqual(storedBuf, inputBuf)) {
    // 验证失败，恢复验证码
    const remainingMs = storedCode.expiresAt - Date.now()
    if (remainingMs > 0) {
      await setStore(`phone_code:${phone}`, storedData, Math.ceil(remainingMs / 1000))
    }
    throw createError({ statusCode: 400, message: '验证码错误' })
  }

  // 查找用户
  let user = await db.select().from(users).where(eq(users.phone, phone)).limit(1).then(r => r[0])

  if (!user) {
    // 自动注册
    const now = getBeijingTime()
    const username = `user_${phone.slice(-4)}_${Date.now().toString(36)}`
    const randomPassword = Math.random().toString(36).slice(-16)
    const hashedPassword = await bcrypt.hash(randomPassword, 12)

    const inserted = (await db
      .insert(users)
      .values({
        username,
        name: `手机用户${phone.slice(-4)}`,
        password: hashedPassword,
        phone,
        phoneVerified: true,
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

    if (!inserted) {
      throw createError({ statusCode: 500, message: '注册失败' })
    }
    user = { ...inserted, role: 'USER' } as any
  } else {
    // 更新登录信息
    await db.update(users).set({
      lastLogin: getBeijingTime(),
      lastLoginIp: clientIP,
      phoneVerified: true
    }).where(eq(users.id, user.id))
  }

  // 生成 JWT
  const token = JWTEnhanced.generateToken(user.id, user.role)
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
    user: { id: user.id, username: user.username, role: user.role },
    isNewUser: !user.phoneVerified // 粗略判断
  }
})
