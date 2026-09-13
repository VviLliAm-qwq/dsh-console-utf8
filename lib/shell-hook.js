/**
 * dsh-console-utf8 — the BASH_ENV hook.
 *
 * `chcp` fixes the console the shell itself is attached to, but the shell
 * executor is free to spawn a command in a fresh console (a detached child
 * gets the system default page back). `BASH_ENV` closes that hole at the top
 * of every non-interactive `bash -c`: bash sources the named file before it
 * runs the command, so the code page is corrected inside the very process
 * group that is about to invoke `powershell.exe` / `cmd.exe` / `git.exe`.
 *
 * Measured 2026-09-13: a non-interactive `bash -c` really does source
 * `$BASH_ENV`, and `chcp.com 65001` issued from it left the following
 * `powershell.exe -Command chcp` reporting 65001 and printing its Chinese
 * message intact.
 *
 * @module dsh-console-utf8/shell-hook
 */

/** File name of the generated hook, written under the dsh state directory. */
export const SHIM_FILE_NAME = 'console-utf8.sh'

/**
 * The hook itself.
 *
 * Constraints, each of them load-bearing:
 *   - silent: stdout/stderr of the code page call are discarded, because the
 *     hook runs in front of every command and any noise would land in the
 *     tool output;
 *   - harmless when `chcp.com` is absent (a POSIX machine): `command -v`
 *     gates it, and the trailing `:` keeps the hook's own exit status 0 so it
 *     can never masquerade as the command's failure;
 *   - POSIX `sh` only, no bashisms: `BASH_ENV` is sourced by bash, but
 *     quoting and `[ ]` conventions here stay portable.
 *
 * @param {number} codePage - Code page the hook switches to (65001 = UTF-8).
 * @returns {string} The complete script text (LF endings, no BOM).
 */
export function shimScript(codePage) {
  return [
    '#!/bin/sh',
    '# dsh-console-utf8 — sourced through BASH_ENV before every non-interactive',
    '# bash command, so Windows-native children of the shell speak UTF-8: that is',
    '# the encoding the dsh subprocess layer decodes their output with.',
    `if command -v chcp.com >/dev/null 2>&1; then chcp.com ${codePage} >/dev/null 2>&1; fi`,
    '# Keep the hook invisible to the command it runs in front of.',
    ':',
    '',
  ].join('\n')
}

/**
 * Convert a Windows path into the `/c/...` form Git Bash resolves.
 *
 * `BASH_ENV` is consumed by an MSYS bash, and `C:\Users\x\.dsh-tui\f.sh`
 * survives that hand-off only by accident. The drive-letter form is
 * deterministic.
 *
 * @param {string} windowsPath - `C:\Users\x\.dsh-tui\console-utf8.sh`.
 * @returns {string} `/c/Users/x/.dsh-tui/console-utf8.sh`; the input with
 *   forward slashes when it carries no drive letter.
 */
export function toPosixPath(windowsPath) {
  const normalized = String(windowsPath).replaceAll('\\', '/')
  const drive = /^([A-Za-z]):(\/.*)?$/.exec(normalized)
  if (drive === null) return normalized
  return `/${drive[1].toLowerCase()}${drive[2] ?? ''}`
}
