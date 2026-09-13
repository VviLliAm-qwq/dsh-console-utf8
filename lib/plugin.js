/**
 * dsh-console-utf8 — keep the Windows console on code page 65001 (UTF-8).
 *
 * WHY THIS EXISTS
 *
 * The dsh subprocess layer decodes every child's stdout as UTF-8
 * (`buffer.toString('utf8')`). Windows-native tools that a bash command
 * invokes — `powershell.exe`, `cmd.exe`, `git.exe`, `chcp.com` itself — write
 * their text in the console's OEM code page instead (936/GBK on a Chinese
 * system, 932 on Japanese, 437 on US-English). The bytes are then read as
 * UTF-8, and every non-ASCII character in that output is destroyed:
 *
 *   chcp           →  the localised line, its Chinese replaced by U+FFFD
 *                     runs — GBK bytes read as UTF-8
 *   after 65001    →  Active code page: 65001
 *   中文测试OK      →  中文测试OK             (measured 2026-09-13)
 *
 * So the mismatch is not the tools' fault, and it is not fixable by decoding
 * harder: the console has to speak the same encoding the decoder assumes.
 * This plugin makes that true, in two places, because the shell executor may
 * spawn a command either inside the host's console or in a fresh one:
 *
 *   1. the host's console is switched to `codePage` through `chcp.com`
 *      (`setHostConsole`), and
 *   2. every non-interactive bash gets a `BASH_ENV` hook that repeats the
 *      switch inside its own process group (`shellHook`).
 *
 * WHAT IT DOES NOT DO
 *
 * It never rewrites a command, never patches the shell stack, never changes
 * PATH, and never reads the user's files beyond the one hook it maintains. It
 * writes exactly two files, both under the dsh state directory: the hook and
 * this plugin's log.
 *
 * @module dsh-console-utf8/plugin
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { ensureConsoleCodePage } from './console-cp.js'
import { createLogger } from './log.js'
import { SHIM_FILE_NAME, shimScript, toPosixPath } from './shell-hook.js'

export const name = 'dsh-console-utf8'

/** Every key carries a default: a missing composition entry changes nothing. */
export const Config = z.object({
  /** Master switch. False mounts the plugin and does nothing. */
  enabled: z.boolean().default(true),
  /** Code page to enforce. 65001 is UTF-8; override only to deliberate. */
  codePage: z.number().default(65001),
  /** Switch the host process's console (the one the TUI was started in). */
  setHostConsole: z.boolean().default(true),
  /** Maintain the BASH_ENV hook so every bash command re-applies it. */
  shellHook: z.boolean().default(true),
  /** Hook path. Empty means `~/.dsh-tui/console-utf8.sh`. */
  shimPath: z.string().default(''),
})

/** Boot defaults mirroring the schema. */
const DEFAULTS = Object.freeze({
  enabled: true,
  codePage: 65001,
  setHostConsole: true,
  shellHook: true,
  shimPath: '',
})

const DIAG_LOG = join(homedir(), '.dsh-tui', 'dsh-console-utf8.log')
/** Inside `node --test` nothing may touch a user's log or hook file. */
const FILE_LOG_ENABLED = typeof process.env?.NODE_TEST_CONTEXT !== 'string'

/**
 * Coerce an untrusted config object into the known keys with valid types.
 *
 * @param {unknown} config - Composition-entry config.
 * @returns {{ enabled: boolean, codePage: number, setHostConsole: boolean,
 *   shellHook: boolean, shimPath: string }} A complete, safe config.
 */
export function sanitizeConfig(config) {
  const out = { ...DEFAULTS }
  if (config === null || typeof config !== 'object') return out
  for (const key of ['enabled', 'setHostConsole', 'shellHook']) {
    if (typeof config[key] === 'boolean') out[key] = config[key]
  }
  if (Number.isInteger(config.codePage) && config.codePage >= 1 && config.codePage <= 65535) {
    out.codePage = config.codePage
  }
  if (typeof config.shimPath === 'string') out.shimPath = config.shimPath
  return out
}

/**
 * Default hook location: the dsh state directory, which is this plugin's only
 * writable home (`docs/DSH-PLUGIN-SOP.md` §2).
 *
 * @param {string} home - User home directory.
 * @returns {string} Absolute hook path.
 */
export function defaultShimPath(home) {
  return join(home, '.dsh-tui', SHIM_FILE_NAME)
}

/**
 * Undo this plugin's `BASH_ENV`, but only while the value is still the one it
 * set: the user or another plugin may have moved it afterwards, and their
 * value must win.
 *
 * @param {Record<string, string | undefined>} env - Environment to edit.
 * @param {string} owned - The value this plugin installed.
 * @returns {'restored' | 'left alone'} What happened.
 */
export function restoreBashEnv(env, owned) {
  if (env.BASH_ENV !== owned) return 'left alone'
  delete env.BASH_ENV
  return 'restored'
}

/**
 * Write the hook when its content differs, creating the directory if needed.
 *
 * A stale hook (an older code page) is the one failure mode that would make
 * the fix silently do the wrong thing, so the file is compared rather than
 * assumed.
 *
 * @param {string} path - Hook path.
 * @param {string} content - Desired content.
 * @returns {boolean} True when the file was (re)written.
 */
export function writeShimIfChanged(path, content) {
  let current
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    current = undefined
  }
  if (current === content) return false
  mkdirSync(dirname(path), { recursive: true })
  // No BOM, LF endings: the file is sourced by `sh`, never parsed as JSON.
  writeFileSync(path, content, 'utf8')
  return true
}

/**
 * Do the work with every side effect injected, so tests can drive it.
 *
 * @param {object} deps - Injected environment.
 * @param {string} deps.platform - `process.platform`.
 * @param {Record<string, string | undefined>} deps.env - Environment to edit.
 * @param {string} deps.home - User home directory.
 * @param {Function} deps.spawnSync - Spawner for `chcp.com`.
 * @param {(path: string, content: string) => boolean} deps.ensureShim - Hook writer.
 * @param {{ info: Function, warn: Function }} deps.log - Logger.
 * @param {object} config - Sanitized config.
 * @returns {{ skipped: string, console: object | null, shim: object | null }}
 */
export function setup(deps, config) {
  const result = { skipped: '', console: null, shim: null }

  if (!config.enabled) {
    result.skipped = 'disabled by config'
    deps.log.info('skipped: disabled by config')
    return result
  }
  if (deps.platform !== 'win32') {
    // POSIX consoles are UTF-8 already; `chcp.com` does not exist there.
    result.skipped = 'not win32'
    deps.log.info('skipped: not win32')
    return result
  }

  if (config.setHostConsole) {
    const { before, after, switched } = ensureConsoleCodePage(config.codePage, deps.spawnSync)
    result.console = { before, after, switched }
    if (before === undefined && after === undefined) {
      // A detached host has no console to read; the shell hook still covers
      // the commands, so this is a note rather than a failure.
      deps.log.warn('host console code page unreadable (no attached console?); shell hook still applies')
    } else if (after === config.codePage) {
      deps.log.info(`host console code page ${before ?? '?'} -> ${after}`)
    } else {
      deps.log.warn(`host console code page is ${after ?? 'unknown'} after asking for ${config.codePage}`)
    }
  }

  if (config.shellHook) {
    const shimPath = config.shimPath === '' ? defaultShimPath(deps.home) : config.shimPath
    const value = toPosixPath(shimPath)
    let written = false
    try {
      written = deps.ensureShim(shimPath, shimScript(config.codePage))
    } catch (error) {
      deps.log.warn(`could not write the shell hook: ${error instanceof Error ? error.message : String(error)}`)
      result.shim = { path: shimPath, applied: false, reason: 'hook not writable' }
      return result
    }

    const existing = typeof deps.env.BASH_ENV === 'string' && deps.env.BASH_ENV !== '' ? deps.env.BASH_ENV : undefined
    if (existing !== undefined && existing !== value) {
      // Someone else owns BASH_ENV. Clobbering it would break their hook, so
      // this plugin stands down and says why; the config can point elsewhere.
      deps.log.warn(`BASH_ENV is already ${existing}; left untouched (set this plugin's shimPath to adopt it)`)
      result.shim = { path: shimPath, applied: false, reason: 'BASH_ENV owned by someone else' }
      return result
    }

    deps.env.BASH_ENV = value
    result.shim = {
      path: shimPath,
      applied: true,
      written,
      previous: undefined,
      value,
    }
    deps.log.info(`BASH_ENV -> ${value} (${written ? 'hook written' : 'hook already current'})`)
  }

  return result
}

/**
 * Wire the plugin.
 *
 * @param {object} ctx - Cordis context of this activation.
 * @param {unknown} config - Composition-entry config.
 */
export function apply(ctx, config) {
  const log = createLogger(ctx, { path: DIAG_LOG, enabled: FILE_LOG_ENABLED })

  try {
    log.info(`apply started pid=${process.pid} node=${process.version} file=${fileURLToPath(import.meta.url)}`)
  } catch {
    // Logging must never be the reason a plugin fails to load.
  }

  try {
    const resolved = sanitizeConfig(config)
    log.info(`config ${JSON.stringify(resolved)}`)

    const result = setup(
      {
        platform: process.platform,
        env: process.env,
        home: homedir(),
        spawnSync,
        ensureShim: writeShimIfChanged,
        log,
      },
      resolved,
    )

    const shim = result.shim
    if (shim !== null && shim.applied === true) {
      const owned = shim.value
      ctx.effect(function* bashEnvEffect() {
        yield () => {
          try {
            log.info(`BASH_ENV ${restoreBashEnv(process.env, owned)}`)
          } catch {
            // Best-effort teardown.
          }
        }
      }, 'dsh-console-utf8 BASH_ENV')
    }

    log.info('apply finished')
  } catch (error) {
    log.warn(`apply failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
