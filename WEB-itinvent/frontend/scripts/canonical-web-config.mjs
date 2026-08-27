import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const CANONICAL_HOST_MARKER = '__HUBIT_CANONICAL_HOST__'
export const DEFAULT_CANONICAL_HOST = 'hubit.zsgp.ru'

export const normalizeCanonicalHost = (value = DEFAULT_CANONICAL_HOST) => {
  const host = String(value || DEFAULT_CANONICAL_HOST).trim().toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(host)) {
    throw new Error('VITE_CANONICAL_HOST may contain only letters, digits, dots, and hyphens')
  }
  return host
}

export const renderCanonicalWebConfig = (content, hostValue = DEFAULT_CANONICAL_HOST) => {
  const host = normalizeCanonicalHost(hostValue)
  const expectedUrl = `https://${host}/{R:1}`

  if (content.includes(CANONICAL_HOST_MARKER)) {
    return content.replaceAll(CANONICAL_HOST_MARKER, host)
  }

  if (content.includes(expectedUrl)) {
    return content
  }

  throw new Error('web.config does not contain the canonical host marker or expected redirect')
}

export const canonicalWebConfig = (currentDir, hostValue) => ({
  name: 'hubit-canonical-web-config',
  writeBundle(outputOptions) {
    if (!outputOptions.dir) {
      throw new Error('Vite output directory is required to render web.config')
    }
    const webConfigPath = resolve(currentDir, outputOptions.dir, 'web.config')
    const current = readFileSync(webConfigPath, 'utf8')
    const rendered = renderCanonicalWebConfig(current, hostValue)
    if (rendered !== current) {
      writeFileSync(webConfigPath, rendered, 'utf8')
    }
  },
})
