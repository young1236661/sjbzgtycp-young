import { createHash, randomBytes } from 'node:crypto'

const accessCode = process.argv.slice(2).join(' ').trim()

if (!accessCode) {
  const suggestedCode = randomBytes(18).toString('base64url')
  console.log('Usage: pnpm hash:access-code "your-private-access-code"')
  console.log('')
  console.log('Suggested access code:')
  console.log(suggestedCode)
  console.log('')
  console.log('Suggested SITE_ACCESS_CODE_SHA256:')
  console.log(hash(suggestedCode))
  process.exit(0)
}

console.log(hash(accessCode))

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}
