import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SHIM_FILE_NAME, shimScript, toPosixPath } from '../lib/shell-hook.js'

test('shimScript switches the page, stays quiet and keeps exit status 0', () => {
  const script = shimScript(65001)
  assert.match(script, /chcp\.com 65001 >\/dev\/null 2>&1/)
  assert.match(script, /command -v chcp\.com/)
  // A hook in front of every command must not print and must not fail one.
  assert.match(script, /\n:\n$/)
  assert.ok(!script.includes('\r'), 'LF endings only')
  assert.ok(!script.startsWith('\uFEFF'), 'no BOM')
})

test('shimScript carries the configured code page', () => {
  assert.match(shimScript(65001), /chcp\.com 65001 /)
  assert.match(shimScript(932), /chcp\.com 932 /)
})

test('toPosixPath converts drive-letter paths for MSYS bash', () => {
  assert.equal(
    toPosixPath('C:\\Users\\alice\\.dsh-tui\\console-utf8.sh'),
    '/c/Users/alice/.dsh-tui/console-utf8.sh',
  )
  assert.equal(toPosixPath('D:/data/shim.sh'), '/d/data/shim.sh')
  assert.equal(toPosixPath('C:'), '/c')
  assert.equal(toPosixPath('/already/posix.sh'), '/already/posix.sh')
})

test('the hook file name is a plain sh script name', () => {
  assert.equal(SHIM_FILE_NAME, 'console-utf8.sh')
})
