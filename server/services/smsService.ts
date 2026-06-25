import crypto from 'node:crypto'

interface AliyunPnvsConfig {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  templateCode: string
}

const ENDPOINT = 'dypnsapi.aliyuncs.com'
const VERSION = '2017-05-25'

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}

function signRequest(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort()
  const cqs = sorted.map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&')
  const sts = `GET&${percentEncode('/')}&${percentEncode(cqs)}`
  return crypto.createHmac('sha1', secret + '&').update(sts).digest('base64')
}

async function callApi(params: Record<string, string>, config: AliyunPnvsConfig): Promise<any> {
  const base: Record<string, string> = {
    Format: 'JSON', Version: VERSION,
    AccessKeyId: config.accessKeyId,
    SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...params
  }
  base.Signature = signRequest(base, config.accessKeySecret)
  const qs = Object.entries(base).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const r = await fetch(`https://${ENDPOINT}/?${qs}`)
  return r.json()
}

/**
 * 发送短信验证码（号码认证 PNVS - dypnsapi）
 * 自己生成验证码，通过阿里云模板发送
 */
export async function sendPnvsSmsCode(
  phone: string,
  config: AliyunPnvsConfig
): Promise<{ success: boolean; code: string; message: string }> {
  const code = crypto.randomInt(100000, 999999).toString()

  try {
    const data = await callApi({
      Action: 'SendSmsVerifyCode',
      PhoneNumber: phone,
      CountryCode: '86',
      CodeLength: '6',
      SignName: config.signName,
      TemplateCode: config.templateCode,
      TemplateParam: JSON.stringify({ code, min: '5' })
    }, config)

    if (data.Code === 'OK') {
      console.log(`[PNVS] 验证码已发送至 ${phone}`)
      return { success: true, code, message: '验证码已发送' }
    } else {
      console.error(`[PNVS] 发送失败: ${data.Code} - ${data.Message}`)
      return { success: false, code: '', message: `${data.Code}: ${data.Message}` }
    }
  } catch (e: any) {
    console.error(`[PNVS] 请求异常: ${e.message}`)
    return { success: false, code: '', message: e.message }
  }
}

/**
 * 校验短信验证码（号码认证 PNVS - dypnsapi）
 */
export async function verifyPnvsSmsCode(
  phone: string,
  code: string,
  config: AliyunPnvsConfig
): Promise<{ success: boolean; message: string }> {
  try {
    const data = await callApi({
      Action: 'VerifySmsCode',
      PhoneNumber: phone,
      CountryCode: '86',
      Code: code,
      SignName: config.signName,
      TemplateCode: config.templateCode
    }, config)

    if (data.Code === 'OK') {
      console.log(`[PNVS] 验证码校验通过: ${phone}`)
      return { success: true, message: '验证通过' }
    } else {
      console.error(`[PNVS] 校验失败: ${data.Code} - ${data.Message}`)
      return { success: false, message: data.Message || '验证码错误' }
    }
  } catch (e: any) {
    console.error(`[PNVS] 校验异常: ${e.message}`)
    return { success: false, message: e.message }
  }
}
