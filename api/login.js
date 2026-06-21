import {
  accessCodeMatches,
  authConfigStatus,
  createSessionToken,
  sendJson,
  setSessionCookie,
} from './_auth.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return sendJson(response, 405, { message: 'Method not allowed' })
  }

  const config = authConfigStatus()
  if (!config.ready) {
    return sendJson(response, 503, { message: config.message })
  }

  const body = await readJsonBody(request)
  const accessCode = String(body.accessCode ?? '')

  if (!accessCodeMatches(accessCode)) {
    return sendJson(response, 401, { message: '访问码无效。' })
  }

  setSessionCookie(response, createSessionToken())
  return sendJson(response, 200, {
    authenticated: true,
    user: 'owner',
  })
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === 'object') return request.body
  if (request.body && typeof request.body === 'string') {
    try {
      return JSON.parse(request.body)
    } catch {
      return {}
    }
  }

  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}
