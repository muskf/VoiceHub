import crypto from 'node:crypto'

interface AliyunSmsConfig {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  templateCode: string
}

/**
 * 阿里云短信服务
 * 使用 Signature v3 签名调用 SendSms API
 */
export async function sendAliyunSms(
  phone: string,
  templateParam: Record<string, string>,
  config: AliyunSmsConfig
): Promise<boolean> {
  const endpoint = 'dysmsapi.aliyuncs.com'
  const action = 'SendSms'
  const version = '2017-05-25'

  const nonce = crypto.randomUUID()
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // 请求参数
  const params: Record<string, string> = {
    Action: action,
    Format: 'JSON',
    PhoneNumbers: phone,
    SignName: config.signName,
    TemplateCode: config.templateCode,
    TemplateParam: JSON.stringify(templateParam),
    Version: version,
    AccessKeyId: config.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
    Timestamp: timestamp
  }

  // 构造签名字符串
  const sortedKeys = Object.keys(params).sort()
  const canonicalizedQueryString = sortedKeys
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&')

  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalizedQueryString)}`

  // HMAC-SHA1 签名
  const signature = crypto
    .createHmac('sha1', config.accessKeySecret + '&')
    .update(stringToSign)
    .digest('base64')

  params.Signature = signature

  // 发送请求
  const queryString = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const url = `https://${endpoint}/?${queryString}`

  try {
    const response = await fetch(url, { method: 'GET' })
    const data = await response.json() as any

    if (data.Code === 'OK') {
      console.log(`[SMS] 验证码已发送至 ${phone}`)
      return true
    } else {
      console.error(`[SMS] 发送失败: ${data.Code} - ${data.Message}`)
      return false
    }
  } catch (e: any) {
    console.error(`[SMS] 请求失败: ${e.message}`)
    return false
  }
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}
