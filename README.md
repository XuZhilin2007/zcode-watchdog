# ZCode Watchdog

A local Windows CLI for monitoring personal Z.ai GLM Coding Plan quota and using reset cards
with durable accounting. 中文说明如下。

**2.0.0-beta.1** — 非官方开源个人工具。安装不启动、不注册任务、不迁移旧版状态。
真实用卡 POST 尚未联调，当前为预发布版。

## 要求

- Windows、Node.js **>=24.15 <25**；无 npm 运行时依赖。
- 在 ZCode 中登录 Z.ai 个人账号，并有可用 Coding Plan 和重置卡。
- 隐藏后台启动需要 Windows Script Host / VBScript；不可用时会报告启动失败。
- 只适配个人 Z.ai 账户；BigModel、团队版及自动续接编码会话不在此版本范围内。

没有会员也可以下载、运行帮助和离线诊断；启用自动重置应等套餐可用后再做。

## 安装

从本仓库固定版本 Release 下载 tgz，或检出对应 tag。以下命令仅安装 CLI：

    npm.cmd install --global .\zcode-watchdog-2.0.0-beta.1.tgz

从源码安装时，在检出的仓库中运行：

    npm.cmd install --global .

安装过程没有启动/配置钩子。不要对仍运行 v1 的原目录执行覆盖更新。
新开 PowerShell 后可以使用 zwd；若脚本执行策略拦住 npm 生成的 ps1 shim，
使用等价的 zwd.cmd，不需要修改全局执行策略。

## 日常四个命令

    zwd
    zwd start
    zwd stop
    zwd config

zwd 默认只读取运行状态和最近快照，显示数据时间；不会用卡。
需要新数据或决策预览时：

    zwd --refresh
    zwd --dry-run

这两个操作只 GET，不预占预算、不迁移状态、不 POST，也不会启用后台。

## 首次配置与启动

以下操作应在准备使用时执行，下载/安装工具本身不要求先配置：

    zwd config --init
    zwd config --daily-limit unlimited
    zwd doctor --refresh
    zwd start
    zwd

默认每日上限 2 张；支持正整数或明确的 unlimited。不限不会关闭幂等保护、冷却或
待确认请求阻断。不会自动继承 v1 的 config.json；已有用户可明确保存自己的不限设置。
启动只读预检成功后才启用后台；重复 start 不会创建第二个实例或重置计数。
关闭 PowerShell 后后台继续运行。

配置只修改指定项，其余值保留：

    zwd config --daily-limit 3
    zwd config --five-hour-threshold 90 --week-threshold 97
    zwd config --poll-seconds 60
    zwd config --autostart on
    zwd config --notifications off

默认阈值为 90% / 97%，轮询 60 秒，正常用卡冷却 30 分钟。
预算按 Asia/Shanghai 自然日；跨日未完成操作不会被遗忘。
配置会通知后台加载；CLI 区分“已确认生效”和“已保存，等待当前检查结束后应用”。

自启默认关闭。显式开启会注册当前用户的 v2 计划任务，登录启动、五分钟保活和心跳检查；
不会启用处于 stopped 状态的自动消费。关闭自启会移除任务，但不停止已经手动启动的后台。

## 自动用卡规则

1. 周额度达到阈值且有周卡时，优先用周卡，同时恢复两个额度池。
2. 否则，五小时额度达到阈值且有五小时卡时，考虑五小时卡。
3. 周额度已耗尽且没有周卡时，保留五小时卡，报告无法恢复。
4. 检查冷却、每日预算及未完成操作；先持久化预占与操作 ID，再发送一次请求。
5. 用卡后复查额度；只有恢复可确认才结束该操作，下一轮使用新数据决策。
6. 额度已耗尽时，不会因为九分钟后自然刷新而无条件等到刷新。
   若有有效近期消耗样本、预计剩余额度足够撑到自然刷新，则优先等待。
7. 超时、断连或含糊响应不自动重发 POST；保留预算，暂停后续消费并提示处理。

它依据账号额度决策，不精确判断任务是否结束；启用期间即使没有编码任务也可能用卡。
只在希望它持续监控时 start，结束后 stop。恢复额度不等于已中断任务自动恢复。

## 状态、停止与排障

    zwd
    zwd logs
    zwd doctor
    zwd --json

状态区分后台存活与自动消费健康；所有缓存标注时间。错误内容为固定本地短语，
不输出凭证、上游正文或原始异常。状态变化会尽力发送 Windows 本地通知，
持续相同故障不反复通知；Windows 可能抑制气泡，仍应以状态和事件记录为准。

    zwd stop

stop 保存停止意图，再协调后台退出；五分钟保活或下一次登录不会重新启用。
已经发出的请求需要完成或超时收尾。停止无法确认时返回错误，不宣称成功。

用卡结果不明时：

    zwd reconcile

该命令只查看。确认账户情况并停止后台后，可保守记为已消费：

    zwd reconcile --assume-used OPERATION_ID

这不会退款、清空账本或重发请求。技术语义见 [安全说明](docs/SAFETY.md)。

## 卸载与以后重装

    zwd uninstall
    npm.cmd uninstall --global zcode-watchdog

第一步停止并移除 v2 自启任务，保留配置与消费账本；第二步移除 CLI。
默认数据在用户主目录下的 .zcode-watchdog，代码换目录不会创建另一套预算。
高级测试可用 ZWD_HOME 指定隔离数据目录；同一用户仍只允许一个后台。
不要通过删除账本修复故障；卸载后是否删除历史数据应单独决定。

旧版 ZCodeWatchdog 任务需要另行退役，参见 [旧版清理流程](docs/LEGACY-CLEANUP.md)。
v2 不会自动停止旧进程、删除旧目录或修改 ZCode 自身凭证。

## 验证与开发

    npm.cmd test
    npm.cmd run check
    npm.cmd run pack:release

测试仅使用模拟凭证/API及临时目录，覆盖超时、崩溃恢复、跨进程竞争、配置错误、
日期切换、账号匹配、CLI、Unicode 隐藏启动和退出码。
任务注册集成只在显式启用的独立 Windows CI 中执行，不在使用者机器自动运行。
打包产物和 SHA256SUMS 位于 dist，白名单排除个人配置、数据库、日志和凭证。

2026-10-23 已只读核对官方 quota/status 接口结构及现有凭证兼容性，没有发送真实 reset/use POST。
真实扣卡恢复、桌面通知可见性和后续客户端版本仍需后续使用验证；这是 beta 的明确边界。
完整边界见 [SAFETY.md](docs/SAFETY.md)，变更见 [CHANGELOG](CHANGELOG.md)。

## License

MIT。与 Z.ai / 智谱无关联。重置卡可能来自活动或闲时发放，有数量和有效期限制；
仅自动化本人账号，并遵守服务商适用规则。
