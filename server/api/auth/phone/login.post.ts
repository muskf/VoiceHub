import bcrypt from 'bcryptjs'
import { db, users } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'
import { getBeijingTime } from '~/utils/timeUtils'
import { isSecureRequest } from '~~/server/utils/request-utils'
import { getClientIP } from '~~/server/utils/ip-utils'
import { checkRateLimit } from '~~/server/utils/rateLimiter'
import { verifyPnvsSmsCode } from '~~/server/services/smsService'

export default defineEventHandler(async (event) => {
  const config = await db.query.systemSettings.findFirst()
  if (!config?.allowPhoneRegistration) {
    throw createError({ statusCode: 403, message: '系统已关闭手机号登录功能' })
  }

  const clientIP = getClientIP(event)

  // IP 限流
  const ipMinLimit = checkRateLimit(`phone_login_ip_m:${clientIP}`, 10, 60 * 1000)
  if (!ipMinLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '操作过于频繁，请稍后再试' })
  }
  const ipDayLimit = checkRateLimit(`phone_login_ip_d:${clientIP}`, 50, 24 * 60 * 60 * 1000)
  if (!ipDayLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '今日登录次数已达上限' })
  }

  const body = await readBody(event)
  const phone = (body?.phone || '').toString().trim()
  const code = (body?.code || '').toString().trim()

  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '请输入有效的手机号码' })
  }
  if (!/^\d{4,8}$/.test(code)) {
    throw createError({ statusCode: 400, message: '请输入验证码' })
  }

  // 手机号限流
  const phoneMinLimit = checkRateLimit(`phone_login_p_m:${phone}`, 5, 60 * 1000)
  if (!phoneMinLimit.isAllowed) {
    throw createError({ statusCode: 429, message: '该手机号登录尝试过于频繁' })
  }

  // 失败锁定检查
  const { getStore, setStore, incrStore, delStore } = await import('~~/server/utils/captchaStore')
  const lockKey = `phone_login_lock:${phone}`
  const isLocked = await getStore(lockKey)
  if (isLocked) {
    throw createError({ statusCode: 429, message: '该手机号已被临时锁定，请10分钟后再试' })
  }

  // 通过阿里云号码认证服务校验验证码
  const verifyResult = await verifyPnvsSmsCode(phone, code, {
    accessKeyId: config.smsAliyunAccessKeyId || '',
    accessKeySecret: config.smsAliyunAccessKeySecret || ''
  })

  if (!verifyResult.success) {
    // 递增失败计数
    const failKey = `phone_login_fail:${phone}`
    const failCount = await incrStore(failKey, 10 * 60)

    if (failCount >= 5) {
      await setStore(lockKey, '1', 10 * 60)
      await delStore(failKey)
      console.warn(`[Phone] ${phone} 连续验证失败 ${failCount} 次，已锁定 (IP: ${clientIP})`)
      throw createError({ statusCode: 429, message: '验证码错误次数过多，已锁定10分钟' })
    }

    throw createError({ statusCode: 400, message: '验证码错误或已过期' })
  }

  // 验证成功 — 清除失败计数
  await delStore(`phone_login_fail:${phone}`)

  // 查找用户
  let user = await db.select().from(users).where(eq(users.phone, phone)).limit(1).then(r => r[0])

  if (user) {
    // 检查用户状态
    if (user.status === 'withdrawn') {
      throw createError({ statusCode: 403, message: '该账号已注销' })
    } else if (user.status === 'graduate') {
      throw createError({ statusCode: 403, message: '该账号已毕业，无法登录' })
    } else if (user.status === 'banned') {
      throw createError({ statusCode: 403, message: '该账号已被封禁' })
    }
  }

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
    isNewUser: !user.phoneVerified
  }
})
