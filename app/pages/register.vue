<template>
  <div class="auth-layout">
    <div class="auth-container">
      <div class="form-section">
        <div class="form-header">
          <div class="logo-row">
            <img :src="brandLogoSrc" alt="Brand Logo" class="brand-logo-center" >
            <div v-if="schoolLogoHomeUrl && schoolLogoHomeUrl.trim()" class="logo-divider" />
            <img
              v-if="schoolLogoHomeUrl && schoolLogoHomeUrl.trim()"
              :src="schoolLogoHomeUrl"
              alt="学校Logo"
              class="school-logo"
            >
          </div>
          <h1 class="form-title">注册新账号</h1>
          <div class="header-divider" />
        </div>

        <form class="auth-form" @submit.prevent="handleRegister">
          <!-- 邮箱 -->
          <div class="form-group">
            <label for="email">邮箱地址</label>
            <div class="input-wrapper">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <input
                id="email"
                v-model="email"
                :disabled="loading || codeSent"
                placeholder="请输入邮箱地址"
                required
                type="email"
              >
            </div>
          </div>

          <!-- 验证码 -->
          <div class="form-group">
            <label for="code">验证码</label>
            <div class="input-wrapper code-row">
              <div class="code-input-wrap">
                <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                <input
                  id="code"
                  v-model="code"
                  :disabled="loading"
                  maxlength="6"
                  placeholder="6位验证码"
                  required
                  type="text"
                >
              </div>
              <button
                class="send-code-btn"
                :class="{ 'code-sent': codeSent }"
                :disabled="loading || !email || countdown > 0"
                type="button"
                @click="sendCode"
              >
                {{ countdown > 0 ? `${countdown}s` : codeSent ? '重新发送' : '发送验证码' }}
              </button>
            </div>
          </div>

          <!-- 用户名 -->
          <div class="form-group">
            <label for="username">用户名</label>
            <div class="input-wrapper">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <input
                id="username"
                v-model="username"
                :disabled="loading"
                placeholder="3-30个字符，英文/数字/下划线/连字符"
                required
                type="text"
              >
            </div>
          </div>

          <!-- 姓名 -->
          <div class="form-group">
            <label for="name">姓名</label>
            <div class="input-wrapper">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
              <input
                id="name"
                v-model="name"
                :disabled="loading"
                placeholder="请输入真实姓名"
                required
                type="text"
              >
            </div>
          </div>

          <!-- 密码 -->
          <div class="form-group">
            <label for="password">密码</label>
            <div class="input-wrapper">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <input
                id="password"
                v-model="password"
                :disabled="loading"
                placeholder="至少8个字符"
                required
                type="password"
              >
            </div>
          </div>

          <!-- 确认密码 -->
          <div class="form-group">
            <label for="confirmPassword">确认密码</label>
            <div class="input-wrapper">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <input
                id="confirmPassword"
                v-model="confirmPassword"
                :disabled="loading"
                placeholder="再次输入密码"
                required
                type="password"
              >
            </div>
          </div>

          <!-- 错误信息 -->
          <div v-if="error" class="error-message">{{ error }}</div>

          <!-- 成功信息 -->
          <div v-if="successMessage" class="success-message">{{ successMessage }}</div>

          <!-- 提交按钮 -->
          <button class="submit-btn" :disabled="loading" type="submit">
            {{ loading ? '注册中...' : '注册' }}
          </button>

          <!-- 登录链接 -->
          <div class="form-footer">
            <span>已有账号？</span>
            <NuxtLink to="/login" class="link">返回登录</NuxtLink>
          </div>
        </form>
      </div>
    </div>
    <SiteFooter />
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue'
import logo from '~~/public/images/logo.svg'

const { siteTitle, initSiteConfig, logoUrl, schoolLogoHomeUrl, allowEmailRegistration, refreshSiteConfig } = useSiteConfig()

const brandLogoSrc = computed(() => {
  const url = logoUrl.value
  if (url && !url.endsWith('.ico')) return url
  return logo
})

const email = ref('')
const code = ref('')
const username = ref('')
const name = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const successMessage = ref('')
const loading = ref(false)
const codeSent = ref(false)
const countdown = ref(0)

let countdownTimer = null

onMounted(async () => {
  await initSiteConfig()
  await refreshSiteConfig()

  if (typeof document !== 'undefined') {
    document.title = `注册 | ${siteTitle.value || 'VoiceHub'}`
  }

  // 如果邮箱注册未启用，重定向到登录页
  if (!allowEmailRegistration.value) {
    await navigateTo('/login')
  }
})

const sendCode = async () => {
  error.value = ''
  successMessage.value = ''

  if (!email.value) {
    error.value = '请输入邮箱地址'
    return
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.value)) {
    error.value = '请输入有效的邮箱地址'
    return
  }

  loading.value = true
  try {
    const res = await $fetch('/api/auth/register/send-code', {
      method: 'POST',
      body: { email: email.value }
    })
    codeSent.value = true
    successMessage.value = res.message || '验证码已发送'
    countdown.value = 60
    countdownTimer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) {
        clearInterval(countdownTimer)
      }
    }, 1000)
  } catch (e) {
    error.value = e.data?.message || e.message || '发送验证码失败'
  } finally {
    loading.value = false
  }
}

const handleRegister = async () => {
  error.value = ''
  successMessage.value = ''

  if (!email.value || !code.value || !username.value || !name.value || !password.value || !confirmPassword.value) {
    error.value = '所有字段均为必填项'
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  if (password.value.length < 8) {
    error.value = '密码长度至少为8个字符'
    return
  }

  loading.value = true
  try {
    await $fetch('/api/auth/register', {
      method: 'POST',
      body: {
        email: email.value,
        code: code.value,
        username: username.value,
        name: name.value,
        password: password.value,
        confirmPassword: confirmPassword.value
      }
    })

    // 注册成功，跳转到首页
    await navigateTo('/')
  } catch (e) {
    error.value = e.data?.message || e.message || '注册失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-layout {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 20px;
  --brand-logo-size: clamp(48px, 8vw, 96px);
  --school-logo-size: clamp(96px, 16vw, 160px);
  --logo-gap: clamp(12px, 2vw, 24px);
  --divider-height: clamp(32px, 10vw, 96px);
  --content-footer-gap: clamp(16px, 4vh, 40px);
}

.auth-container {
  width: 100%;
  max-width: 480px;
  background: var(--bg-secondary);
  border-radius: var(--radius-2xl);
  border: 1px solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  margin: auto 0;
  margin-bottom: var(--content-footer-gap);
}

.form-section {
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.form-header {
  text-align: center;
  margin-bottom: 20px;
}

.logo-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--logo-gap);
  margin-bottom: 12px;
}

.logo-divider {
  width: 1px;
  height: var(--divider-height);
  background: var(--border-secondary);
}

.brand-logo-center {
  width: var(--brand-logo-size);
  height: var(--brand-logo-size);
  object-fit: contain;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.15));
}

.school-logo {
  width: var(--school-logo-size);
  height: var(--school-logo-size);
  object-fit: contain;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.15));
}

.form-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}

.header-divider {
  height: 1px;
  background: var(--border-secondary);
  margin: 14px auto 0;
  width: 100%;
}

.auth-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-wrapper input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.input-wrapper input:focus {
  border-color: var(--accent-primary, #3b82f6);
}

.input-wrapper input:disabled {
  opacity: 0.6;
}

.input-icon {
  position: absolute;
  left: 10px;
  width: 16px;
  height: 16px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.code-row {
  display: flex;
  gap: 8px;
}

.code-input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.code-input-wrap input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.code-input-wrap input:focus {
  border-color: var(--accent-primary, #3b82f6);
}

.send-code-btn {
  flex-shrink: 0;
  padding: 10px 16px;
  background: var(--accent-primary, #3b82f6);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.2s;
}

.send-code-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-code-btn.code-sent {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-primary);
}

.error-message {
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
  color: #ef4444;
  font-size: 13px;
}

.success-message {
  padding: 10px 12px;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: 8px;
  color: #22c55e;
  font-size: 13px;
}

.submit-btn {
  padding: 12px;
  background: var(--accent-primary, #3b82f6);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  margin-top: 4px;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.form-footer {
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.form-footer .link {
  color: var(--accent-primary, #3b82f6);
  text-decoration: none;
  font-weight: 600;
}

.form-footer .link:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .auth-layout {
    padding: 10px;
  }

  .auth-container {
    border-radius: 16px;
  }

  .form-section {
    padding: 30px 20px;
  }
}
</style>
