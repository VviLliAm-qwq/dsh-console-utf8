/**
 * dsh-console-utf8 — console code page primitives.
 *
 * A Windows console owns its code page, and every console process attached to
 * it inherits that page. `chcp.com` reports it and rewrites it; because the
 * value belongs to the CONSOLE rather than to the calling process, a
 * short-lived child changes what its parent and its siblings observe
 * (measured 2026-09-13: a piped `chcp.com 65001` child left a later sibling
 * `powershell.exe` reporting 65001).
 *
 * Every function here takes its spawner as an argument so tests can drive
 * fabricated output: no test may touch the real console.
 *
 * @module dsh-console-utf8/console-cp
 */

/** Turn whatever a spawner returned (string, Buffer or undefined) into text. */
function asText(value) {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return ''
}

/**
 * Parse the code page number out of `chcp` output.
 *
 * The text around the number is localised ("Active code page: 65001",
 * "活动代码页: 65001") and on a non-UTF-8 console it frequently arrives already
 * mangled, so only the digits are trusted: the first 2–5 digit run wins.
 *
 * @param {unknown} output - Raw `chcp.com` stdout.
 * @returns {number | undefined} The code page, or undefined when unparseable.
 */
export function parseCodePage(output) {
  const match = /(\d{2,5})/.exec(asText(output))
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined
}

/**
 * How both calls are made. stdout is PIPED on purpose: the host's screen must
 * never receive "Active code page: …". Piping stdio does not detach the
 * console — the child still inherits it and still rewrites its code page.
 */
const CALL_OPTIONS = Object.freeze({
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 5000,
  windowsHide: true,
})

/**
 * Read the code page of the console this process is attached to.
 *
 * @param {Function} spawnSync - `node:child_process` spawnSync (or a stand-in).
 * @returns {number | undefined} The code page, or undefined when there is no
 *   readable console.
 */
export function readConsoleCodePage(spawnSync) {
  try {
    const result = spawnSync('chcp.com', [], CALL_OPTIONS)
    if (result === null || result === undefined || result.status !== 0) return undefined
    return parseCodePage(result.stdout)
  } catch {
    return undefined
  }
}

/**
 * Ask the shared console to switch to `codePage`.
 *
 * @param {number} codePage - Target code page (65001 = UTF-8).
 * @param {Function} spawnSync - `node:child_process` spawnSync (or a stand-in).
 * @returns {boolean} True when `chcp.com` exited 0.
 */
export function switchConsoleCodePage(codePage, spawnSync) {
  try {
    const result = spawnSync('chcp.com', [String(codePage)], CALL_OPTIONS)
    return result !== null && result !== undefined && result.status === 0
  } catch {
    return false
  }
}

/**
 * Bring the console to `codePage` and report the page it is left on.
 *
 * The read-back matters: a sandbox, a foreign locale or a denied console can
 * accept the call and still leave the old page in place, and the log should
 * say so instead of claiming success.
 *
 * @param {number} codePage - Target code page.
 * @param {Function} spawnSync - `node:child_process` spawnSync (or a stand-in).
 * @returns {{ before: number | undefined, after: number | undefined,
 *   switched: boolean }} Observed pages and whether a call was made.
 */
export function ensureConsoleCodePage(codePage, spawnSync) {
  const before = readConsoleCodePage(spawnSync)
  if (before === codePage) return { before, after: before, switched: false }
  const accepted = switchConsoleCodePage(codePage, spawnSync)
  const after = readConsoleCodePage(spawnSync)
  return { before, after, switched: accepted }
}
