import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalWebConfig,
  DEFAULT_CANONICAL_HOST,
  normalizeCanonicalHost,
  renderCanonicalWebConfig,
} from './canonical-web-config.mjs'

describe('canonical web.config build guard', () => {
  it('uses the production host when no override is configured', () => {
    const source = 'url="https://__HUBIT_CANONICAL_HOST__/{R:1}"'

    expect(renderCanonicalWebConfig(source)).toBe(
      `url="https://${DEFAULT_CANONICAL_HOST}/{R:1}"`,
    )
  })

  it('normalizes a configured host', () => {
    expect(normalizeCanonicalHost(' Preview.Example.COM ')).toBe('preview.example.com')
  })

  it('accepts an already rendered config for the expected host', () => {
    const rendered = 'url="https://preview.example.com/{R:1}"'

    expect(renderCanonicalWebConfig(rendered, 'preview.example.com')).toBe(rendered)
  })

  it('rejects invalid or conflicting redirect hosts', () => {
    expect(() => normalizeCanonicalHost('https://hubit.zsgp.ru')).toThrow()
    expect(() => renderCanonicalWebConfig(
      'url="https://wrong.example.com/{R:1}"',
      'hubit.zsgp.ru',
    )).toThrow()
  })

  it('renders the web.config in the actual Vite output directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'hubit-canonical-config-'))
    const outputDir = join(root, 'dist-verify')
    mkdirSync(outputDir)
    const webConfigPath = join(outputDir, 'web.config')
    writeFileSync(webConfigPath, 'https://__HUBIT_CANONICAL_HOST__/{R:1}', 'utf8')

    try {
      canonicalWebConfig(root).writeBundle({ dir: outputDir })
      expect(readFileSync(webConfigPath, 'utf8')).toBe(
        `https://${DEFAULT_CANONICAL_HOST}/{R:1}`,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
