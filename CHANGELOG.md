# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## 0.1.2 (2026-09-13)

- Documentation only, no code change. The READMEs gain a CI badge, the release section records that publishing goes through npm trusted publishing (OIDC) with no stored token, and the duplicated publishing heading is merged into one section.

## 0.1.1 (2026-09-13)

- Documentation only, no code change. The "host switch" limitation now records what a restarted dsh-tui session measured: the Windows launcher starts the host without a console of its own, so every `chcp.com` child gets a fresh console, the host half logs its warning, and the `BASH_ENV` hook carries the whole fix. The warning is expected on every start, not a fault.

## 0.1.0 (2026-09-13)

- Initial release.
- Host console: switches the console the dsh host was started in to code page 65001 via `chcp.com`, reads the page back and logs what was observed.
- Shell hook: writes a `BASH_ENV` hook under the dsh state directory so every non-interactive `bash -c` re-applies the code page inside its own process group, and restores `BASH_ENV` on unload only while it is still the value this plugin set.
- Bounded lifecycle log at `~/.dsh-tui/dsh-console-utf8.log` (newest half kept past 128 KiB; nothing is written under `node --test`).
- Config: `enabled`, `codePage`, `setHostConsole`, `shellHook`, `shimPath` — every key defaulted, so an empty composition entry is a safe no-op.
- Windows only: every other platform takes the `not win32` path and changes nothing.
