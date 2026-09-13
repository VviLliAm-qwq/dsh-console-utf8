# dsh-console-utf8

**English** · [中文](README.zh.md)

Keeps the Windows console on code page **65001 (UTF-8)** for the dsh host and for the commands the bash tool runs, so output from Windows-native child processes stops arriving as mojibake.

## The problem

The dsh subprocess layer decodes every child's stdout as UTF-8. Windows-native tools that a bash command invokes — `powershell.exe`, `cmd.exe`, `git.exe`, and `chcp.com` itself — write their text in the console's OEM code page instead (936/GBK on a Chinese system, 932 on Japanese, 437 on US-English). The bytes are then read as UTF-8 and every non-ASCII character in that output is destroyed:

| Console state | `chcp` output |
|---|---|
| default (936) | the localised line, its Chinese replaced by U+FFFD runs |
| after `chcp 65001` | `Active code page: 65001` |

It is not a decoding bug that can be fixed by decoding harder: the console has to speak the same encoding the decoder assumes. That is all this plugin does.

## What it does

- **Host console** (`setHostConsole`, default on): switches the console the dsh host was started in to the configured code page using `chcp.com`, then reads the page back and logs what the console actually reports — a sandbox or a foreign locale that accepts the call and keeps the old page is reported instead of being claimed as a success.
- **Shell hook** (`shellHook`, default on): maintains `~/.dsh-tui/console-utf8.sh` and points `BASH_ENV` at it, so every non-interactive `bash -c` re-applies the code page inside its own process group. This covers the case where the shell executor spawns a command in a fresh console, which would otherwise start back at the system default.
- **Diagnostics**: a bounded lifecycle log at `~/.dsh-tui/dsh-console-utf8.log` records the resolved config, the observed code page before and after, and the hook decision. It is trimmed to its newest half once it passes 128 KiB, and nothing is written while `node --test` is running.

Exactly two files are written, both under the dsh state directory: the hook and the log. Commands are never rewritten, PATH is never touched, the shell stack is never patched, and no other file is read.

## Install

```sh
dsh plugin --profile <profile> add dsh-console-utf8
```

Restart the TUI afterwards (`/restart`) — the plugin acts at mount time.

Manual installation: copy the package into `~/.dsh/profiles/<profile>/node_modules/dsh-console-utf8/` and append `"dsh-console-utf8"` to `dsh.profile.bundles` in that profile's `package.json`. The package declares `dsh.bundle.patch`, so it mounts itself at boot.

## Compatibility

| Item | Value |
|---|---|
| Platform | Windows only (`win32`); any other platform takes the `not win32` path and changes nothing |
| Host | dsh-tui with manifest v0.15 / `v1alpha1` host facet |
| Node | `^22.19 || >=24`, pure ESM |
| Contributes | nothing — no command, no permission, no contract, no seam registration |
| Shell stack | benefits any stack whose commands go through a Windows console; the `BASH_ENV` hook only applies to **bash** (`sh`/`dash` are unaffected) |

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch. `false` mounts the plugin and does nothing. |
| `codePage` | number | `65001` | Code page to enforce. Override only deliberately. |
| `setHostConsole` | boolean | `true` | Switch the host process's console. |
| `shellHook` | boolean | `true` | Maintain the `BASH_ENV` hook. |
| `shimPath` | string | `''` | Hook path. Empty means `~/.dsh-tui/console-utf8.sh`. |

## Known limitations

- **Root cause is upstream.** This plugin makes the console match the decoder's assumption; it does not change how the subprocess layer decodes output. A host that decodes with a fallback would not need it.
- **`BASH_ENV` is shared.** If another tool already set `BASH_ENV` to a different path, the plugin stands down and logs why rather than clobbering it; point `shimPath` at that path to adopt it, or disable `shellHook`.
- **`bash` only.** The hook is not read by `sh`, `dash`, `zsh` or PowerShell, and a command that resets the code page itself (`chcp 936`) wins until the next command.
- **The host switch needs a console the host owns.** When the host starts without one — a headless probe, and the Windows dsh-tui launcher, which hands the host no console handle — every `chcp.com` child gets a console of its own, so the switch cannot take effect. The plugin logs a warning instead of claiming success, and the shell hook then carries the whole fix. Measured twice: in the 0.1.0 integration probe and in a real restarted dsh-tui session. Expect the `host console code page … after asking for …` warning on every start; it is not a fault.
- **Per console, not per system.** A newly created console starts at the system default again; use the system-wide UTF-8 setting if that is what you want.
- **The hook costs one `chcp.com` per bash invocation** (a few milliseconds), silenced so it never reaches the tool output.
- **Nothing already copied is repaired.** Text that is mojibake in the clipboard or in a file stays that way.
- Verified on Windows 11 with a CP936 system locale; other code pages are expected to behave the same but were not measured.

## Development

```sh
pnpm install
npm run verify          # encoding sweep + unit tests + manifest + pack layout
node --test             # unit tests only
npm run check:encoding  # BOM / damaged-sequence sweep
npm run validate:manifest
npm run pack:verify     # published file list, and that no shipped module is missing
```

The unit tests never touch the real console or the user's files: the code-page calls, the hook writer and the environment are injected.

## Publishing

Version tags drive the release (`vX.Y.Z`, tag = `package.json` version). The repository ships a GitHub Actions workflow that runs the verification chain and publishes to npm with provenance.

## License

MIT. See [LICENSE](LICENSE).

Built for [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI).
