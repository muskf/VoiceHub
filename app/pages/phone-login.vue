<template>
  <div class="auth-layout">
    <div class="auth-container">
      <div class="form-section">
        <div class="form-header">
          <div class="logo-row">
            <img :src="brandLogoSrc" alt="Brand Logo" class="brand-logo-center">
            <div v-if="schoolLogoHomeUrl && schoolLogoHomeUrl.trim()" class="logo-divider" />
            <img
              v-if="schoolLogoHomeUrl && schoolLogoHomeUrl.trim()"
              :src="schoolLogoHomeUrl"
              alt="学校Logo"
              class="school-logo"
            >
          </div>
          <h1 class="form-title">手机号登录</h1>
          <div class="header-divider" />
        </div>

        <form class="auth-form" @submit.prevent="handlePhoneLogin">
          <!-- 手机号 + 验证码横排 -->
          <div class="form-row">
            <div class="form-group phone-group">
              <label for="phone">手机号</label>
              <div class="input-wrapper">
                <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
                <input
                  id="phone"
                  v-model="phone"
                  :disabled="loading"
                  maxlength="11"
                  placeholder="11位手机号"
                  required
                  type="tel"
                >
              </div>
            </div>
            <div class="form-group code-group">
              <label for="code">验证码</label>
              <div class="code-row">
                <input
                  id="code"
                  v-model="code"
                  :disabled="loading"
                  maxlength="6"
                  placeholder="验证码"
                  required
                  type="text"
                >
                <button
                  class="send-code-btn"
                  :class="{ 'code-sent': codeSent }"
                  :disabled="loading || !phone || countdown > 0"
                  type="button"
                  @click="sendCode"
                >
                  {{ countdown > 0 ? `${countdown}s` : codeSent ? '重发' : '获取' }}
                </button>
              </div>
            </div>
          </div>

          <!-- 人机验证 -->
          <CaptchaInput
            v-if="captchaEnabled && captchaProvider !== 'turnstile'"
            ref="captchaRef"
            v-model="captchaInput"
            @update:captchaId="captchaId = $event"
          />
          <TurnstileWidget
            v-if="captchaEnabled && captchaProvider === 'turnstile'"
            v-model="captchaInput"
            @update:captchaId="captchaId = $event"
          />

          <!-- 错误信息 -->
          <div v-if="error" class="error-message">{{ error }}</div>

          <!-- 横排按钮 -->
          <div class="btn-row">
            <button class="submit-btn" :disabled="loading" type="submit">
              {{ loading ? '...' : '登录 / 注册' }}
            </button>
            <NuxtLink to="/login" class="back-link">密码登录</NuxtLink>
          </div>

          <p class="hint-text">未注册的手机号将自动创建账号</p>
        </form>
      </div>
    </div>
    <SiteFooter />
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue'
import logo from '~~/public/images/logo.svg'
import CaptchaInput from '~/components/Auth/CaptchaInput.vue'
import TurnstileWidget from '~/components/Auth/TurnstileWidget.vue'

const { siteTitle, initSiteConfig, logoUrl, schoolLogoHomeUrl, brandLogoSvgUrl, allowPhoneRegistration, captchaEnabled, captchaProvider, refreshSiteConfig } = useSiteConfig()

const brandLogoSrc = computed(() => {
  if (brandLogoSvgUrl.value) return brandLogoSvgUrl.value
  const url = logoUrl.value
  if (url && !url.endsWith('.ico')) return url
  return logo
})

const phone = ref('')
const code = ref('')
const error = ref('')
const loading = ref(false)
const codeSent = ref(false)
const countdown = ref(0)
const captchaId = ref('')
const captchaInput = ref('')
const captchaRef = ref(null)

let countdownTimer = null

onMounted(async () => {
  await initSiteConfig()
  await refreshSiteConfig()
  if (typeof document !== 'undefined') {
    document.title = `手机号登录 | ${siteTitle.value || 'VoiceHub'}`
  }
  if (!allowPhoneRegistration.value) {
    await navigateTo('/login')
  }
})

const sendCode = async () => {
  error.value = ''
  if (!phone.value || !/^1[3-9]\d{9}$/.test(phone.value)) {
    error.value = '请输入有效的11位手机号'
    return
  }

  loading.value = true
  try {
    const body = { phone: phone.value }
    if (captchaEnabled.value) {
      body.captchaId = captchaId.value
      body.captchaInput = captchaInput.value.trim()
    }
    await $fetch('/api/auth/phone/send-code', { method: 'POST', body })
    codeSent.value = true
    countdown.value = 60
    countdownTimer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) clearInterval(countdownTimer)
    }, 1000)
  } catch (e) {
    error.value = e.data?.message || e.message || '发送验证码失败'
    if (captchaRef.value?.refreshCaptcha) captchaRef.value.refreshCaptcha()
  } finally {
    loading.value = false
  }
}

const handlePhoneLogin = async () => {
  error.value = ''
  if (!phone.value || !code.value) {
    error.value = '请输入手机号和验证码'
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/phone/login', {
      method: 'POST',
      body: { phone: phone.value, code: code.value }
    })
    await navigateTo('/')
  } catch (e) {
    error.value = e.data?.message || e.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-layout {
  min-height: 100vh; background: var(--bg-primary);
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  padding: 20px;
  --brand-logo-size: clamp(48px, 8vw, 96px);
  --school-logo-size: clamp(96px, 16vw, 160px);
  --logo-gap: clamp(12px, 2vw, 24px);
  --divider-height: clamp(32px, 10vw, 96px);
  --content-footer-gap: clamp(16px, 4vh, 40px);
}
.auth-container {
  width: 100%; max-width: 520px; background: var(--bg-secondary);
  border-radius: var(--radius-2xl); border: 1px solid var(--border-primary);
  box-shadow: var(--shadow-lg); overflow: hidden; margin: auto 0;
  margin-bottom: var(--content-footer-gap);
}
.form-section { padding: 32px 28px; display: flex; flex-direction: column; align-items: center; }
.form-header { text-align: center; margin-bottom: 16px; }
.logo-row { display: flex; align-items: center; justify-content: center; gap: var(--logo-gap); margin-bottom: 8px; }
.logo-divider { width: 1px; height: var(--divider-height); background: var(--border-secondary); }
.brand-logo-center { width: var(--brand-logo-size); height: var(--brand-logo-size); object-fit: contain; }
.school-logo { width: var(--school-logo-size); height: var(--school-logo-size); object-fit: contain; }
.form-title { font-size: 22px; font-weight: 700; color: var(--text-primary); }
.header-divider { height: 1px; background: var(--border-secondary); margin: 10px auto 0; width: 100%; }
.auth-form { width: 100%; display: flex; flex-direction: column; gap: 12px; }

/* 横排：手机号 + 验证码 */
.form-row { display: flex; gap: 12px; }
.phone-group { flex: 1.2; }
.code-group { flex: 1; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.input-wrapper { position: relative; display: flex; align-items: center; }
.input-wrapper input {
  width: 100%; padding: 9px 10px 9px 32px; background: var(--bg-tertiary);
  border: 1px solid var(--border-primary); border-radius: 8px;
  color: var(--text-primary); font-size: 14px; outline: none;
}
.input-wrapper input:focus { border-color: var(--accent-primary, #3b82f6); }
.input-icon { position: absolute; left: 8px; width: 16px; height: 16px; color: var(--text-tertiary); pointer-events: none; }
.code-row { display: flex; gap: 6px; }
.code-row input {
  flex: 1; padding: 9px 10px; background: var(--bg-tertiary);
  border: 1px solid var(--border-primary); border-radius: 8px;
  color: var(--text-primary); font-size: 14px; outline: none; width: 60px;
}
.code-row input:focus { border-color: var(--accent-primary, #3b82f6); }
.send-code-btn {
  flex-shrink: 0; padding: 9px 12px; background: var(--accent-primary, #3b82f6);
  color: white; border: none; border-radius: 8px; font-size: 12px;
  font-weight: 600; cursor: pointer; white-space: nowrap;
}
.send-code-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.send-code-btn.code-sent { background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-primary); }

.error-message { padding: 8px 10px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px; color: #ef4444; font-size: 12px; }

/* 横排按钮 */
.btn-row { display: flex; gap: 10px; align-items: center; }
.submit-btn {
  flex: 1; padding: 10px; background: var(--accent-primary, #3b82f6);
  color: white; border: none; border-radius: 8px; font-size: 14px;
  font-weight: 600; cursor: pointer;
}
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.back-link {
  flex-shrink: 0; padding: 10px 16px; background: var(--bg-tertiary);
  border: 1px solid var(--border-primary); border-radius: 8px;
  color: var(--text-secondary); text-decoration: none; font-size: 13px;
  font-weight: 600; white-space: nowrap;
}
.back-link:hover { background: var(--bg-hover); }
.hint-text { font-size: 11px; color: var(--text-tertiary); text-align: center; margin: 0; }

@media (max-width: 480px) {
  .form-row { flex-direction: column; gap: 8px; }
  .auth-layout { padding: 10px; }
  .form-section { padding: 24px 16px; }
}
</style>
