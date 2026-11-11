import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Android assetlinks IIS delivery', () => {
  it('keeps Digital Asset Links outside long-lived static caching', () => {
    const webConfig = readFileSync(path.resolve('public/web.config'), 'utf8')

    expect(webConfig).toContain('<location path=".well-known/assetlinks.json">')
    expect(webConfig).toMatch(
      /<location path="\.well-known\/assetlinks\.json">[\s\S]*?<clientCache cacheControlMode="DisableCache" \/>/,
    )
  })
})
