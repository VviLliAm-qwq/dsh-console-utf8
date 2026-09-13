import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { Config, apply, defaultShimPath, restoreBashEnv, sanitizeConfig, setup } from '../lib/plugin.js'
import { shimScript, toPosixPath } from '../lib/shell-hook.js'

/** A Cordis-context stand-in recording logs and effect disposers. */
function makeCtx() {
  const record = { logs: [], cleanups: [], effectLabel: undefined }
  const ctx = {
    logger: {
      info: (message) => record.logs.push(['info', message]),
      warn: (message) => record.logs.push(['warn', message]),
      debug: () => {},
    },
    effect(callback, label) {
      record.effectLabel = label
      const result = callback()
      if (result !== null && typeof result === 'object' && typeof result.next === 'function') {
        const step = result.next()
        const disposer = step.value
        record.cleanups.push(() => {
          if (typeof disposer === 'function') disposer()
          result.next()
        })
      }
      return ctx
    },
  }
  return { ctx, record, dispose: () => record.cleanups.forEach((cleanup) => cleanup()) }
}

/** A console whose page really changes, plus a recording hook writer. */
function makeDeps(overrides = {}) {
  const console_ = { current: 936, calls: [] }
  const spawnSync = (file, args) => {
    console_.calls.push([file, ...args])
    if (args.length === 1 && /^\d+$/.test(args[0])) console_.current = Number(args[0])
    return { status: 0, stdout: `Active code page: ${console_.current}\r\n` }
  }
  const shims = []
  const logs = []
  const deps = {
    platform: 'win32',
    env: {},
    home: 'C:\\Users\\tester',
    spawnSync,
    ensureShim: (path, content) => {
      shims.push([path, content])
      return true
    },
    log: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
    },
    __console: console_,
    __shims: shims,
    __logs: logs,
    ...overrides,
  }
  return deps
}

test('Config resolves every key from an empty object', () => {
  const resolved = Config({})
  assert.deepEqual(resolved, {
    enabled: true,
    codePage: 65001,
    setHostConsole: true,
    shellHook: true,
    shimPath: '',
  })
})

test('sanitizeConfig defaults, coerces and rejects nonsense', () => {
  assert.deepEqual(sanitizeConfig(undefined), {
    enabled: true,
    codePage: 65001,
    setHostConsole: true,
    shellHook: true,
    shimPath: '',
  })
  assert.deepEqual(sanitizeConfig({ enabled: false, codePage: 932, shellHook: false, shimPath: '/x.sh' }), {
    enabled: false,
    codePage: 932,
    setHostConsole: true,
    shellHook: false,
    shimPath: '/x.sh',
  })
  // Out-of-range and wrong-typed values fall back instead of propagating.
  assert.equal(sanitizeConfig({ codePage: 0 }).codePage, 65001)
  assert.equal(sanitizeConfig({ codePage: 99999 }).codePage, 65001)
  assert.equal(sanitizeConfig({ codePage: '65001' }).codePage, 65001)
  assert.equal(sanitizeConfig({ enabled: 'yes' }).enabled, true)
  assert.equal(sanitizeConfig({ shimPath: 7 }).shimPath, '')
  assert.equal(sanitizeConfig(null).enabled, true)
})

test('defaultShimPath lives in the dsh state directory', () => {
  assert.equal(defaultShimPath('C:\\Users\\tester'), join('C:\\Users\\tester', '.dsh-tui', 'console-utf8.sh'))
})

test('setup switches the host console and installs the hook on win32', () => {
  const deps = makeDeps()
  const result = setup(deps, sanitizeConfig({}))

  assert.equal(result.skipped, '')
  assert.deepEqual(result.console, { before: 936, after: 65001, switched: true })
  assert.equal(result.shim.applied, true)
  assert.equal(result.shim.written, true)
  assert.equal(deps.__console.current, 65001)

  const shimPath = defaultShimPath('C:\\Users\\tester')
  assert.equal(result.shim.path, shimPath)
  assert.deepEqual(deps.__shims, [[shimPath, shimScript(65001)]])
  assert.equal(deps.env.BASH_ENV, toPosixPath(shimPath))
})

test('setup honours every switch', () => {
  const off = makeDeps()
  assert.equal(setup(off, sanitizeConfig({ enabled: false })).skipped, 'disabled by config')
  assert.deepEqual(off.__shims, [])
  assert.equal(off.env.BASH_ENV, undefined)
  assert.equal(off.__console.calls.length, 0)

  const posix = makeDeps({ platform: 'linux' })
  assert.equal(setup(posix, sanitizeConfig({})).skipped, 'not win32')
  assert.equal(posix.env.BASH_ENV, undefined)

  const noConsole = makeDeps()
  const result = setup(noConsole, sanitizeConfig({ setHostConsole: false }))
  assert.equal(result.console, null)
  assert.equal(noConsole.__console.calls.length, 0)

  const noHook = makeDeps()
  const hookless = setup(noHook, sanitizeConfig({ shellHook: false }))
  assert.equal(hookless.shim, null)
  assert.equal(noHook.env.BASH_ENV, undefined)
  assert.equal(noHook.__console.current, 65001)
})

test('setup respects a shimPath override and reuses an owned BASH_ENV', () => {
  const custom = makeDeps()
  const shimPath = 'C:\\Users\\tester\\custom-hook.sh'
  const result = setup(custom, sanitizeConfig({ shimPath }))
  assert.equal(result.shim.path, shimPath)
  assert.equal(custom.env.BASH_ENV, toPosixPath(shimPath))

  const own = makeDeps({ env: { BASH_ENV: toPosixPath(defaultShimPath('C:\\Users\\tester')) } })
  assert.equal(setup(own, sanitizeConfig({})).shim.applied, true)
})

test('setup stands down when someone else owns BASH_ENV', () => {
  const deps = makeDeps({ env: { BASH_ENV: '/c/other/hook.sh' } })
  const result = setup(deps, sanitizeConfig({}))

  assert.equal(result.shim.applied, false)
  assert.match(result.shim.reason, /BASH_ENV/)
  assert.equal(deps.env.BASH_ENV, '/c/other/hook.sh')
  assert.ok(deps.__logs.some(([level, message]) => level === 'warn' && message.includes('BASH_ENV')))
})

test('setup survives an unwritable hook', () => {
  const deps = makeDeps({
    ensureShim: () => {
      throw new Error('EPERM')
    },
  })
  const result = setup(deps, sanitizeConfig({}))

  assert.equal(result.shim.applied, false)
  assert.match(result.shim.reason, /not writable/)
  assert.equal(deps.env.BASH_ENV, undefined)
  assert.ok(deps.__logs.some(([level]) => level === 'warn'))
})

test('restoreBashEnv only clears a value it still owns', () => {
  const owned = { BASH_ENV: '/c/hook.sh' }
  assert.equal(restoreBashEnv(owned, '/c/hook.sh'), 'restored')
  assert.equal('BASH_ENV' in owned, false)
  assert.equal(restoreBashEnv(owned, '/c/hook.sh'), 'left alone')

  const moved = { BASH_ENV: '/c/other.sh' }
  assert.equal(restoreBashEnv(moved, '/c/hook.sh'), 'left alone')
  assert.equal(moved.BASH_ENV, '/c/other.sh')
})

test('apply is a no-op that still logs when disabled', () => {
  const { ctx, record } = makeCtx()
  // The one config that cannot touch this machine's real console or files:
  // the disabled path returns before any side effect, which is also what a
  // test run needs.
  apply(ctx, { enabled: false })

  assert.equal(record.effectLabel, undefined)
  assert.ok(record.logs.some(([, message]) => message.includes('apply started')))
  assert.ok(record.logs.some(([, message]) => message.includes('disabled by config')))
  assert.ok(record.logs.some(([, message]) => message.includes('apply finished')))
})

test('apply never throws on a broken context', () => {
  assert.doesNotThrow(() => apply(undefined, { enabled: false }))
  assert.doesNotThrow(() => apply({ effect: () => {} }, { enabled: 'nonsense' }))
})
