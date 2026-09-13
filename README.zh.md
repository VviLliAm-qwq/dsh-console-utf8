# dsh-console-utf8

[English](README.md) · **中文**

把 **dsh 宿主**和 **bash 工具命令**所用的 Windows 控制台固定在代码页 **65001（UTF-8）**，让 Windows 原生子进程的输出不再变成乱码。

## 问题是什么

dsh 的子进程层统一按 UTF-8 解码每个子进程的 stdout。而 bash 命令里调用的 Windows 原生工具 —— `powershell.exe`、`cmd.exe`、`git.exe`，甚至 `chcp.com` 自己 —— 是用控制台的 OEM 代码页输出的（中文系统 936/GBK，日文 932，美式英文 437）。这些字节被当成 UTF-8 读取后，其中每一个非 ASCII 字符都会被打碎：

| 控制台状态 | `chcp` 的输出 |
|---|---|
| 默认（936） | 本地化文案里的中文被替换成一串 U+FFFD |
| 执行 `chcp 65001` 之后 | `Active code page: 65001` |

这不是「解码再努力一点」能解决的问题：控制台必须说出解码方所假定的那种编码。本插件做的只有这一件事。

## 它做什么

- **宿主控制台**（`setHostConsole`，默认开）：用 `chcp.com` 把 dsh 宿主启动时所在的控制台切换到配置的代码页，然后**回读**实际生效的代码页并写进日志 —— 沙箱或异常区域设置可能出现「调用返回成功但代码页没变」，这种情况会被如实记录，而不是被当成成功。
- **shell 钩子**（`shellHook`，默认开）：维护 `~/.dsh-tui/console-utf8.sh` 并把 `BASH_ENV` 指向它，使每一次非交互 `bash -c` 都在自己的进程组里重新应用一次代码页。这覆盖了「shell 执行器在新控制台里拉起命令」的情形 —— 那种情况下代码页会退回系统默认值。
- **可诊断性**：`~/.dsh-tui/dsh-console-utf8.log` 记录解析后的配置、切换前后的代码页以及钩子决策；超过 128 KiB 时裁掉旧的一半；`node --test` 下不写任何日志。

全程只写两个文件，都在 dsh 状态目录下：钩子与日志。不重写命令、不动 PATH、不打补丁到 shell 栈，除这两个文件外不读取任何用户文件。

## 安装

```sh
dsh plugin --profile <profile> add dsh-console-utf8
```

之后**重启 TUI**（`/restart`）—— 插件在挂载时动作。

手工安装：把包复制到 `~/.dsh/profiles/<profile>/node_modules/dsh-console-utf8/`，并把 `"dsh-console-utf8"` 追加进该 profile `package.json` 的 `dsh.profile.bundles`。包内声明了 `dsh.bundle.patch`，启动时会自行挂载。

## 兼容性

| 项 | 值 |
|---|---|
| 平台 | 仅 Windows（`win32`）；其他平台走 `not win32` 分支，什么都不改 |
| 宿主 | dsh-tui，manifest v0.15 / `v1alpha1` host facet |
| Node | `^22.19 || >=24`，纯 ESM |
| 贡献面 | 无 —— 不注册命令、不申请权限、不声明契约、不使用接缝 |
| shell 栈 | 任何经由 Windows 控制台执行命令的栈都受益；`BASH_ENV` 钩子只对 **bash** 生效（`sh`/`dash` 不受影响） |

## 配置

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `enabled` | boolean | `true` | 总开关。`false` 时插件照常挂载但什么都不做。 |
| `codePage` | number | `65001` | 要强制使用的代码页。非必要不建议改。 |
| `setHostConsole` | boolean | `true` | 切换宿主进程所在的控制台。 |
| `shellHook` | boolean | `true` | 维护 `BASH_ENV` 钩子。 |
| `shimPath` | string | `''` | 钩子路径。留空表示 `~/.dsh-tui/console-utf8.sh`。 |

## 已知限制

- **根因在上游**：本插件让控制台迁就解码方的假设，并没有改变子进程层「一律按 UTF-8 解码」这件事。若宿主改为带回退的解码，这个插件就不需要了。
- **`BASH_ENV` 是共享的**：若已有其他工具把它设成了别的路径，插件会**让位并记录原因**，而不是覆盖它；可以把 `shimPath` 指向那个路径来接管，或关闭 `shellHook`。
- **只对 bash 生效**：`sh`、`dash`、`zsh`、PowerShell 都不读这个钩子；命令自身重置代码页（如 `chcp 936`）会在下一条命令之前一直生效。
- **宿主那一半需要宿主真正拥有的控制台**：当宿主启动时就没有自己的控制台 —— 无头探测如此，Windows 上 dsh-tui 的启动器也如此（它不把控制台句柄交给宿主）—— 每个 `chcp.com` 子进程会各自拿到一个新控制台，切换无法生效。此时插件**记录警告**而不谎报成功，改由 shell 钩子独自承担修复。已实测两次：0.1.0 的集成探测，以及真实重启后的 dsh-tui 会话。每次启动都会看到 `host console code page … after asking for …` 这条 warn，**它不是故障**。
- **按控制台生效，不是全系统**：新建的控制台会回到系统默认值；需要全系统生效请改用系统的 UTF-8 区域设置。
- **每条 bash 命令多一次 `chcp.com`**（几毫秒），输出已静默，不会混进工具结果。
- **不修复已经损坏的内容**：剪贴板或文件里已经乱掉的字不会因此恢复。
- 已在 Windows 11 / CP936 系统区域设置下实测；其他代码页预期行为一致，但未实测。

## 开发

```sh
pnpm install
npm run verify          # 编码扫描 + 单测 + manifest + 发布包布局
node --test             # 只跑单测
npm run check:encoding  # BOM / 损坏序列扫描
npm run validate:manifest
npm run pack:verify     # 发布文件清单，以及「有没有模块漏进清单」
```

单元测试**不会**碰真实控制台或用户文件：代码页调用、钩子写入器与环境全部由外部注入。

## 发布

版本由 tag 驱动（`vX.Y.Z`，tag 必须等于 `package.json` 的 version）。仓库自带 GitHub Actions 工作流：先跑完整校验链，再带 provenance 发布到 npm。

## 许可

MIT，见 [LICENSE](LICENSE)。

为 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 构建。
