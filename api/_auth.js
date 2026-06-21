import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const COOKIE_NAME = 'ticai_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export function sendJson(response, status, body) {
  response.status(status).json(body)
}

export function authConfigStatus() {
  const secret = getSecret()
  const hashes = getAllowedCodeHashes()
  if (!secret || secret.length < 32) {
    return {
      ready: false,
      message: '缺少 AUTH_SECRET，或长度少于 32 个字符。',
    }
  }
  if (hashes.length === 0) {
    return {
      ready: false,
      message: '缺少 SITE_ACCESS_CODE_SHA256，请先配置访问码哈希。',
    }
  }
  return { ready: true, message: 'ready' }
}

export function hashAccessCode(accessCode) {
  return createHash('sha256').update(String(accessCode).trim()).digest('hex')
}

export function accessCodeMatches(accessCode) {
  const actualHash = hashAccessCode(accessCode)
  const actual = Buffer.from(actualHash, 'hex')

  return getAllowedCodeHashes().some((expectedHash) => {
    if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false
    const expected = Buffer.from(expectedHash, 'hex')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  })
}

export function createSessionToken() {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: 'owner',
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
    jti: randomBytes(12).toString('hex'),
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = sign(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null
  const [encodedPayload, signature] = token.split('.')
  const expectedSignature = sign(encodedPayload)
  if (!safeEqual(signature, expectedSignature)) return null

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function getSessionFromRequest(request) {
  const token = readCookie(request, COOKIE_NAME)
  return verifySessionToken(token)
}

export function setSessionCookie(response, token) {
  response.setHeader('Set-Cookie', buildCookie(COOKIE_NAME, token, SESSION_MAX_AGE_SECONDS))
}

export function clearSessionCookie(response) {
  response.setHeader('Set-Cookie', buildCookie(COOKIE_NAME, '', 0))
}

function getSecret() {
  return process.env.AUTH_SECRET ?? ''
}

function getAllowedCodeHashes() {
  const configured = process.env.SITE_ACCESS_CODE_SHA256 ?? process.env.SITE_ACCESS_CODE_HASH ?? ''
  const hashes = configured
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (hashes.length > 0) return hashes
  if (process.env.SITE_ACCESS_CODE) return [hashAccessCode(process.env.SITE_ACCESS_CODE)]
  return []
}

function sign(value) {
  return createHmac('sha256', getSecret()).update(value).digest('base64url')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie ?? ''
  const cookies = cookieHeader.split(';').map((item) => item.trim())
  const match = cookies.find((item) => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

function buildCookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url')
}
