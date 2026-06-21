import { clearSessionCookie, sendJson } from './_auth.js'

export default function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return sendJson(response, 405, { message: 'Method not allowed' })
  }

  clearSessionCookie(response)
  return sendJson(response, 200, { authenticated: false })
}
