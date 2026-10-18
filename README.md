# zcode-watchdog

> An unofficial watchdog that keeps your **GLM Coding Plan** quota alive during long unattended
> runs: it polls the 5-hour window and weekly quota through the same endpoints the ZCode client
> uses, and automatically consumes a reset card *before* you run dry. Docs in Chinese below.

**ZCode / GLM Coding Plan 额度自动重置看门狗**（非官方个人工具）。

无人值守跑长任务时，自动监控 z.ai GLM Coding Plan 的 5 小时窗口与周额度，接近耗尽时
自动使用对应重置卡，避免任务因额度耗尽中断。

## 为什么需要它

ZCode 客户端其实内置了自动重置逻辑，但它的轮询在应用窗口最小化 / 隐藏时会停止——
恰恰是无人值守场景靠不住。本工具独立于 ZCode 进程运行，直接复用本地登录凭证调用
官方同款接口，不消耗任何模型额度。

## 功能

- 每 60 秒轮询 5 小时窗口与周额度用量
- 5h 窗口剩余 ≤10%（可配）→ 自动用一张**五小时重置卡**
- 周额度剩余 ≤3%（可配）→ 自动用一张**周重置卡**
- 保险丝：同一类型 30 分钟冷却；额度自然刷新前 10 分钟内不烧卡（等免费刷新）；
  每日用卡总量上限可配（默认不限）
- 凭证每轮从 ZCode 本地存储重新读取并解密，token 刷新自动跟进，明文不落盘
- 网络异常自动跳过、下轮重试；日志超 5MB 自动轮转
- 纯 Node.js 标准库实现，零依赖

## 工作原理

| 用途 | 接口 |
|---|---|
| 查额度 | `GET https://api.z.ai/api/monitor/usage/quota/limit` |
| 查重置卡余量 | `GET https://zcode.z.ai/api/v1/coding-plan/reset/status` |
| 使用重置卡 | `POST https://zcode.z.ai/api/v1/coding-plan/reset/use` |

凭证读取自 `~/.zcode/v2/credentials.json`（`enc:v1` 前缀，AES-256-GCM，密钥由本机
环境确定性派生，与 ZCode 客户端一致），每轮在内存中解密使用，不产生明文文件。

## 使用

要求：Node.js ≥ 18；本机已登录 ZCode（GLM Coding Plan，z.ai 个人订阅）。

```bash
node watchdog.mjs            # 前台运行
node watchdog.mjs --dry-run  # 只打印决策，不真正用卡
node watchdog.mjs --once     # 单次检查后退出
```

Windows 下可双击 `start-watchdog.bat`（崩溃后 30 秒自动重启）。

## 开机自启（推荐：计划任务）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install-task.ps1
```

注册为 Windows 计划任务：**登录自启、崩溃 1 分钟自动重启、无执行时限**，与 ZCode
进程完全解耦——ZCode 关闭、电脑重启都不影响监控。卸载用 `uninstall-task.ps1`。

> 注意：不要只依赖在某个终端或宿主进程（比如 ZCode 会话）里前台运行——宿主一关，
> 看门狗就没了。计划任务或独立运行 `start-watchdog.bat` 才是无人值守的正确姿势。

## 配置（config.json）

| 键 | 默认 | 说明 |
|---|---|---|
| pollMs | 60000 | 轮询间隔（毫秒） |
| thresholdPct | 90 | 5h 窗口已用达到该值（剩余 10%）触发五小时卡 |
| weekThresholdPct | 97 | 周额度已用达到该值（剩余 3%）触发周卡 |
| maxCardsPerDay | 0 | 每日自动用卡总量上限，0 = 不限量 |
| cooldownMs | 1800000 | 同一类型两次用卡的最小间隔 |
| rolloverGraceMs | 600000 | 额度自然刷新前多久不再用卡 |
| dryRun | false | true 只记录不真用 |

## 安全与隐私

- 不向任何第三方上传数据；凭证只在本机内存中解密使用
- 重置卡是**付费资产**：建议先 `--dry-run` 观察决策是否符合预期，并按需收紧
  `maxCardsPerDay` 与阈值
- 仅用于自动化你本人订阅的账号，请遵守服务条款

## 已知限制

- 接口逆向自 ZCode 客户端（v1.0.0 时点），z.ai 接口变更可能导致功能失效
- 凭证依赖 ZCode 定期刷新；长期不打开 ZCode 导致 token 过期时，重新登录一次即恢复
- 仅适配个人版订阅（`Bigmodel-Target-Type: PERSONAL`），团队版未适配

## 免责声明

非官方工具，与 Z.ai / 智谱无关联。使用风险自负。

## License

MIT
