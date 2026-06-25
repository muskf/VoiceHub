import crypto from 'node:crypto'

interface AliyunPnvsConfig {
  accessKeyId: string
  accessKeySecret: string
}

const ENDPOINT = 'dypnsapi.aliyuncs.com'
const VERSION = '2017-05-25'

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}

function signRequest(params: Record<string, string>, accessKeySecret: string): string {
  const sortedKeys = Object.keys(params).sort()
  const canonicalized = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&')
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalized)}`
  return crypto
    .createHmac('sha1', accessKeySecret + '&')
    .update(stringToSign)
    .digest('base64')
}

async function callPnvsApi(params: Record<string, string>, config: AliyunPnvsConfig): Promise<any> {
  const baseParams: Record<string, string> = {
    Format: 'JSON',
    Version: VERSION,
    AccessKeyId: config.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...params
  }

  baseParams.Signature = signRequest(baseParams, config.accessKeySecret)

  const qs = Object.entries(baseParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const resp = await fetch(`https://${ENDPOINT}/?${qs}`, { method: 'GET' })
  return resp.json()
}

/**
 * 发送短信验证码（号码认证服务 PNVS）
 * 阿里云自动生成并发送验证码，无需签名/模板
 */
export async function sendPnvsSmsCode(
  phone: string,
  config: AliyunPnvsConfig
): Promise<{ success: boolean; message: string }> {
  try {
    const data = await callPnvsApi({
      Action: 'SendSmsVerifyCode',
      PhoneNumber: phone,
      CountryCode: '86',
      CodeLength: '6'
    }, config)

    if (data.Code === 'OK') {
      console.log(`[PNVS] 验证码已发送至 ${phone}`)
      return { success: true, message: '验证码已发送' }
    } else {
      console.error(`[PNVS] 发送失败: ${data.Code} - ${data.Message}`)
      return { success: false, message: data.Message || '发送失败' }
    }
  } catch (e: any) {
    console.error(`[PNVS] 请求异常: ${e.message}`)
    return { success: false, message: e.message }
  }
}

/**
 * 校验短信验证码（号码认证服务 PNVS）
 * 由阿里云校验，返回校验结果
 */
export async function verifyPnvsSmsCode(
  phone: string,
  code: string,
  config: AliyunPnvsConfig
): Promise<{ success: boolean; message: string }> {
  try {
    const data = await callPnvsApi({
      Action: 'VerifySmsCode',
      PhoneNumber: phone,
      CountryCode: '86',
      Code: code
    }, config)

    if (data.Code === 'OK') {
      console.log(`[PNVS] 验证码校验通过: ${phone}`)
      return { success: true, message: '验证通过' }
    } else {
      console.error(`[PNVS] 验证码校验失败: ${data.Code} - ${data.Message}`)
      return { success: false, message: data.Message || '验证码错误' }
    }
  } catch (e: any) {
    console.error(`[PNVS] 校验异常: ${e.message}`)
    return { success: false, message: e.message }
  }
}
