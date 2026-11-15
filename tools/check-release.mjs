// Проверяет, что в release/ лежат ровно те zip, которые ищет лаунчер Sevensave,
// и что .app в mac-архивах подписан хотя бы ad-hoc (лаунчер зовёт codesign --verify --deep).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const dir = new URL('../release/', import.meta.url).pathname
const expected = [`Zaderzhka-${version}-mac-arm64.zip`, `Zaderzhka-${version}-mac-x64.zip`, `Zaderzhka-${version}-win-x64.zip`]
let ok = true
for (const name of expected) {
  const file = join(dir, name)
  if (!existsSync(file)) {
    console.error(`нет ${name}`)
    ok = false
    continue
  }
  console.log(`есть ${name}`)
  const list = execFileSync('unzip', ['-l', file], { encoding: 'utf8' })
  if (name.includes('-win-') && !/Zaderzhka\.exe/.test(list)) {
    console.error(`  в ${name} нет Zaderzhka.exe`)
    ok = false
  }
  if (name.includes('-mac-')) {
    if (!/Zaderzhka\.app\//.test(list)) {
      console.error(`  в ${name} нет Zaderzhka.app`)
      ok = false
      continue
    }
    if (process.platform === 'darwin') {
      const tmp = mkdtempSync(join(tmpdir(), 'zaderzhka-'))
      try {
        execFileSync('/usr/bin/ditto', ['-x', '-k', file, tmp])
        execFileSync('/usr/bin/codesign', ['--verify', '--deep', join(tmp, 'Zaderzhka.app')])
        console.log('  codesign --verify --deep: ок')
      } catch (e) {
        console.error(`  подпись не прошла: ${e.message}`)
        ok = false
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }
  }
}
process.exit(ok ? 0 : 1)
