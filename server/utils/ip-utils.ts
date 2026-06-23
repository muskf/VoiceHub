import type { H3Event } from 'h3'
import { getHeaders } from 'h3'

/**
 * 获取客户端IP地址
 * @param event H3Event对象
 * @returns 客户端IP地址
 */
export function getClientIP(event: H3Event): string {
  // 获取直接连接的IP
  const remoteAddress = event.node.req.socket?.remoteAddress?.replace(/^::ffff:/, '') || ''

  // 判断直接连接是否来自可信代理（本地回环或配置的代理IP）
  const trustedProxies = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
  const envProxies = process.env.TRUSTED_PROXY_IPS?.split(',').map(ip => ip.trim()) || []
  const allTrusted = [...trustedProxies, ...envProxies]
  const isTrustedProxy = allTrusted.some(p => remoteAddress === p || remoteAddress === p.replace(/^::ffff:/, ''))

  // 仅当直接连接来自可信代理时，才信任代理头部
  if (isTrustedProxy) {
    const headers = getHeaders(event)
    const ipHeaders = [
      'cf-connecting-ip', // Cloudflare（优先级最高）
      'x-real-ip',
      'x-client-ip',
      'x-forwarded-for',
      'x-forwarded',
      'forwarded-for',
      'forwarded'
    ]

    for (const header of ipHeaders) {
      const value = headers[header]
      if (value) {
        const ip = Array.isArray(value) ? value[0] : value
        // x-forwarded-for 可能包含多个IP，取第一个（最左侧，原始客户端）
        const firstIP = ip.split(',')[0].trim()
        if (firstIP && isValidIP(firstIP)) {
          return firstIP
        }
      }
    }
  }

  // 直接连接IP或无代理头部时使用直接连接IP
  if (remoteAddress && isValidIP(remoteAddress)) {
    return remoteAddress
  }

  return 'unknown'
}

/**
 * 验证IP地址格式是否有效
 * @param ip IP地址字符串
 * @returns 是否为有效IP
 */
function isValidIP(ip: string): boolean {
  // 简单的IP格式验证
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/

  // 基本格式验证
  if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
    return false
  }

  // 排除明显无效的IP
  if (ip === '0.0.0.0' || ip === '::') {
    return false
  }

  return true
}

/**
 * 格式化IP地址用于邮件显示
 * @param ip IP地址
 * @returns 格式化后的IP地址字符串
 */
export function formatIPForEmail(ip: string): string {
  if (!ip || ip === 'unknown') {
    return '未知'
  }

  // 如果是本地IP，显示为本地访问
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.')
  ) {
    return `${ip} (本地网络)`
  }

  return ip
}
