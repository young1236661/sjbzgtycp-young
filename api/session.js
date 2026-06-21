import { authConfigStatus, getSessionFromRequest, sendJson } from './_auth.js'

export default function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return sendJson(response, 405, { message: 'Method not allowed' })
  }

  const config = authConfigStatus()
  if (!config.ready) {
    return sendJson(response, 503, { authenticated: false, message: config.message })
  }

  const session = getSessionFromRequest(request)
  if (!session) {
    return sendJson(response, 401, { authenticated: false })
  }

  return sendJson(response, 200, {
    authenticated: true,
    user: session.sub,
    expiresAt: new Date(session.exp * 1000).toISOString(),
  })
}
