import { createError, defineEventHandler, getQuery } from 'h3'
import { db } from '~/drizzle/db'
import { users, systemSettings } from '~/drizzle/schema'
import { and, ilike, or, ne, eq } from 'drizzle-orm'

import { checkRateLimit } from '~~/server/utils/rateLimiter'
import { getClientIP } from '~~/server/utils/ip-utils'

export default defineEventHandler(async (event) => {
  const clientIP = getClientIP(event)
  const searchLimitKey = `user_search_ip:${clientIP}`
  const searchLimitResult = checkRateLimit(searchLimitKey, 30, 60 * 1000)
  if (!searchLimitResult.isAllowed) {
    throw createError({ statusCode: 429, message: '搜索请求过于频繁，请稍后再试' })
  }
  // 验证用户登录
  const user = event.context.user
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未登录'
    })
  }

  const query = getQuery(event)
  const { keyword } = query

  const settings = await db.select().from(systemSettings).limit(1)
  if (settings[0]?.enableCollaborativeSubmission === false) {
    throw createError({
      statusCode: 403,
      message: '联合投稿功能已关闭'
    })
  }

  if (!keyword || typeof keyword !== 'string' || keyword.trim().length < 1) {
    return {
      success: true,
      users: []
    }
  }

  const searchTerm = keyword.trim()

  try {
    // 搜索用户，排除自己
    const results = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        class: users.class,
        grade: users.grade
      })
      .from(users)
      .where(
        and(
          ne(users.id, user.id), // 排除自己
          eq(users.status, 'active'), // 仅搜索活跃用户
          or(ilike(users.name, `%${searchTerm}%`), ilike(users.username, `%${searchTerm}%`))
        )
      )
      .limit(10) // 限制返回数量

    // 模糊处理姓名函数
    const maskName = (name: string) => {
      if (!name) return name
      if (name.length <= 2) return name
      return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1]
    }

    return {
      success: true,
      users: results.map((u) => ({
        ...u,
        name: maskName(u.name)
      }))
    }
  } catch (error) {
    console.error('搜索用户失败:', error)
    throw createError({
      statusCode: 500,
      message: '搜索用户失败'
    })
  }
})
