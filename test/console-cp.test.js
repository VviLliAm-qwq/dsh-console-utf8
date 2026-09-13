import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ensureConsoleCodePage,
  parseCodePage,
  readConsoleCodePage,
  switchConsoleCodePage,
} from '../lib/console-cp.js'

/**
 * A stand-in for `spawnSync` backed by a console whose page really changes,
 * so the read-back logic is exercised instead of assumed.
 */
function makeConsole(initial) {
  const record = { current: initial, calls: [] }
  const spawnSync = (file, args) => {
    record.calls.push([file, ...args])
    if (file !== 'chcp.com') return { status: 1, stdout: '' }
    if (args.length === 1 && /^\d+$/.test(args[0])) {
      record.current = Number(args[0])
      return { status: 0, stdout: `Active code page: ${record.current}\r\n` }
    }
    return { status: 0, stdout: `Active code page: ${record.current}\r\n` }
  }
  return { record, spawnSync }
}

test('parseCodePage reads the number out of localised and mangled output', () => {
  assert.equal(parseCodePage('Active code page: 65001'), 65001)
  assert.equal(parseCodePage('活动代码页: 936\r\n'), 936)
  // The message itself may be mojibake — the digits survive, and they are all
  // that is trusted. Written as escapes: the source stays clean ASCII here.
  assert.equal(parseCodePage('\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\u04B3: 936\r\n'), 936)
  assert.equal(parseCodePage('Active code page: 65001\r\n'), 65001)
})

test('parseCodePage trusts bytes as well as strings, and rejects junk', () => {
  assert.equal(parseCodePage(Buffer.from('Active code page: 932', 'utf8')), 932)
  assert.equal(parseCodePage('no digits here'), undefined)
  assert.equal(parseCodePage(''), undefined)
  assert.equal(parseCodePage(undefined), undefined)
  assert.equal(parseCodePage(null), undefined)
})

test('readConsoleCodePage returns the current page and tolerates a failing chcp', () => {
  const { record, spawnSync } = makeConsole(936)
  assert.equal(readConsoleCodePage(spawnSync), 936)
  assert.deepEqual(record.calls, [['chcp.com']])

  assert.equal(readConsoleCodePage(() => ({ status: 1, stdout: '' })), undefined)
  assert.equal(
    readConsoleCodePage(() => {
      throw new Error('spawn ENOENT')
    }),
    undefined,
  )
})

test('switchConsoleCodePage passes the page through and reports the exit code', () => {
  const { record, spawnSync } = makeConsole(936)
  assert.equal(switchConsoleCodePage(65001, spawnSync), true)
  assert.equal(record.current, 65001)
  assert.deepEqual(record.calls.at(-1), ['chcp.com', '65001'])

  assert.equal(switchConsoleCodePage(65001, () => ({ status: 1 })), false)
  assert.equal(
    switchConsoleCodePage(65001, () => {
      throw new Error('spawn ENOENT')
    }),
    false,
  )
})

test('ensureConsoleCodePage reports before/after and skips a needless switch', () => {
  const already = makeConsole(65001)
  assert.deepEqual(ensureConsoleCodePage(65001, already.spawnSync), {
    before: 65001,
    after: 65001,
    switched: false,
  })
  // One read only: no switch was attempted, so no second call either.
  assert.equal(already.record.calls.length, 1)

  const switching = makeConsole(936)
  assert.deepEqual(ensureConsoleCodePage(65001, switching.spawnSync), {
    before: 936,
    after: 65001,
    switched: true,
  })

  // A console that refuses the change must be reported as unchanged, not as
  // a success — the log is the only place a user can see this.
  const stubborn = makeConsole(936)
  const stubbornSpawn = (file, args) => (args.length === 0 ? stubborn.spawnSync(file, args) : { status: 0, stdout: '' })
  assert.deepEqual(ensureConsoleCodePage(65001, stubbornSpawn), {
    before: 936,
    after: 936,
    switched: true,
  })
})
