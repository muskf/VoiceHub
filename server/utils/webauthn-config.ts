import { H3Event, getRequestHeader, getRequestHost, getRequestProtocol, createError } from 'h3'

function parseAllowedOrigins(): string[] {
  const env = process.env.WEBAUTHN_ORIGIN
  if (!env) return []
  return env.split(',').map(o => o.trim()).filter(Boolean)
}

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) {
    // 生产环境下必须显式配置 WEBAUTHN_ORIGIN
    if (process.env.NODE_ENV === 'production') {
      console.warn('[WebAuthn] WEBAUTHN_ORIGIN 未配置，生产环境存在安全风险')
    }
    return true // 开发环境允许任意源
  }
  return allowedOrigins.includes(origin)
}

export function getWebAuthnConfig(event: H3Event) {
  const host = getRequestHost(event)
  const protocol = getRequestProtocol(event, { xForwardedProto: true })
  const allowedOrigins = parseAllowedOrigins()
  
  let rpID = process.env.WEBAUTHN_RP_ID
  
  if (!rpID) {
    rpID = host.split(':')[0]
  }

  let origin: string
  const requestOrigin = getRequestHeader(event, 'origin') || `${protocol}://${host}`

  if (process.env.WEBAUTHN_ORIGIN) {
    if (isOriginAllowed(requestOrigin, allowedOrigins)) {
      origin = requestOrigin
    } else {
      console.error(`WebAuthn origin 不在允许列表中: ${requestOrigin}`)
      throw createError({ statusCode: 403, message: `不被允许的 Origin: ${requestOrigin}` })
    }
  } else {
    origin = requestOrigin
  }

  return { rpID, origin, allowedOrigins }
}
