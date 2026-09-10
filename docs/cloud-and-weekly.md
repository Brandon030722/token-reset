# 云端邮件与本机每周额度 · 0.8

## 本次部署验证（2026-09-10）

- 公开仓库：[Brandon030722/token-reset](https://github.com/Brandon030722/token-reset)；[线上观察站](https://brandon030722.github.io/token-reset/)。
- [首次云端监控](https://github.com/Brandon030722/token-reset/actions/runs/34404338357)成功采集 60 条公开动态并建立历史基线；未发现达到门槛的事件，未发送公告邮件。
- [云端连接测试](https://github.com/Brandon030722/token-reset/actions/runs/34404795905)通过，指定测试收件人已确认收信。测试邮件明确标注非重置公告，没有向订阅名单群发。
- [网站发布](https://github.com/Brandon030722/token-reset/actions/runs/34404296046)在启用 Pages 后重新运行成功；已实测线上页面读取真实公开动态。首次启用之前的 404 失败通知是历史记录。
- 云端 `TIBO_SEND_EMAIL=true`，管理员本机 `sendEmail=false`，由云端单独发送公告邮件。分发包仍不包含管理员密钥或个人额度。
- 回归测试通过：7 项 TypeScript、94 项 Python；macOS 0.7.0 构建与签名校验通过，打包后的 helper 已成功读取本机真实七天窗口。未来真实每周到点通知尚未经过完整一周的实机等待验证；相关状态转换通过模拟时钟测试。

## 提醒链路

| 提醒 | 读取内容 | 执行位置 | 电脑关机时 |
| --- | --- | --- | --- |
| 广泛重置邮件 | Tibo 公开推文，满足 80 分规则门槛 | GitHub Actions → Brevo | 云端继续尝试监控与发信 |
| 小范围公告、广泛重置的系统通知 | 公开推文 | 本机菜单栏应用 | 本机通知暂停 |
| 正常每周额度系统通知 | 本机已登录 Codex 的实际七天窗口 | 本机 Codex app-server → 系统通知 | 等开机并成功读取后检查 |
| 个人每周到点邮件（需启用） | 本机提前同步的下一次恢复时间 | GitHub Actions → Brevo 单收件人 | 已同步预约继续执行，无需本机再次读取 |

个人周邮件仅发给配置的本人邮箱，不发给公共订阅名单，无需达到 80 分。仅预约信息上传到 GitHub 加密 Secret；用量与 Codex 登录凭据保留本机。

## 本机 Codex 对接

在 macOS 的「我的额度」标签查看七天窗口剩余额度和服务返回的恢复时间。程序优先找到本机 `codex`，也支持 `/Applications/ChatGPT.app/Contents/Resources/codex`；需要安装并登录 Codex。使用自定义位置时，可在私有 monitor.config.json 中设置 `codexExecutable` 的完整可执行文件路径。

采用官方 `account/read`、`account/rateLimits/read` 接口；初始化后读取并核对账号，完成就退出。没有读取或导出 auth.json、登录令牌，也不启动模型任务或兑换重置券。优先使用 rateLimitsByLimitId，并只选择 windowDurationMins=10080 的窗口，**不假设 primary 是五小时、secondary 是每周**。若服务返回不同模型的独立周额度，则分别展示；没有五小时窗口时不会创建五小时倒计时。

usedPercent 是实际已用比例，界面剩余为 100-usedPercent；这是额度百分比，与公告的实验性评分不同。resetsAt 是服务返回的时间。到达此前记录的时间且再次成功读取同一账号后，发一条“每周恢复时间已到，请核对额度”的通知，不把时间到达表述成已确认到账。不根据时间自行推算、无限重复加七天。

首次读取不追发历史记录；账号切换会清除旧账号待提醒项，提前发生额外重置时采用新的恢复时间。丢失周窗口、退出登录、接口失败或数据过期时不发新的每周提醒。休眠后在 24 小时内恢复有效读取可补提醒；更旧窗口不补发。系统通知仍受授权、专注模式及系统投递情况影响。

私有文件在 ~/.tibo-reset：codex-usage.sqlite3（去重状态和身份摘要）、codex-usage.json（供本机面板读取）。私有状态文件均不进入 public/data、安装包或 Git 仓库；启用周邮件时，从中提取最少预约信息存入 GitHub Secret。空闲时无额外 Codex helper 常驻，短时 app-server 在每轮读取后清理；主界面仍按需创建 WebView。

## 15 分钟检查

本机轮询、防频繁请求间隔、Windows 定时配置和 macOS 安装脚本均为 15 分钟。云端按每小时第 7、22、37、52 分钟请求运行。GitHub 调度会抖动，15 分钟是目标检查频率，不是延迟保证；过密的一轮会遵守去重/间隔保护。

已有手动安装的 launchd 或 Windows 任务不会因应用更新自动改写：需要使用新版对应安装脚本重新安装。只运行菜单栏应用的用户无需额外安装系统任务。

## 云端部署

- Cloud monitor and email：独立的 Python 工作流，定时采集、持久化状态、发信；发信前运行 Python 回归测试。前端构建或 Pages 故障不阻断邮件监控。
- Publish website：代码变动或手动触发时构建静态页面；页面直接读取仓库 main/public/data 的公开导出，避免每 15 分钟重新构建。GitHub 原始文件 CDN 可能缓存，页面根据采集时间及 health/snapshot 一致性处理过期。
- Secrets：BREVO_API_KEY、BREVO_LIST_ID、BREVO_FROM_EMAIL；仅用于手动验证的 BREVO_TEST_RECIPIENT。
- Variables：BREVO_OPT_IN_CONFIRMED=true；验证完成后 TIBO_SEND_EMAIL=true。
- 首次轮询建立历史基线，不补发旧事件。确认云端成功运行后关闭本机 sendEmail；两份状态库不能分布式去重。
- 手动运行工作流可选择 test_email，只向指定测试地址发一封清楚标注的连接测试。普通 schedule 不会发测试邮件。API 返回受理不等于收件箱送达。

云端密钥与个人预约仅保存在 GitHub Secrets；公开状态没有个人额度、身份、邮件地址、恢复时间或登录凭据。个人发信账本仅含随机事件 ID 和发送状态。开源仓库及免费 Actions 不保证永久免费或国内网络始终可用。

接口依据：[OpenAI App Server](https://learn.chatgpt.com/docs/app-server#rate-limits-chatgpt)。此集成使用本机协议生成工具核对过字段结构，版本差异或接口失败会显示不可用。


## 0.8 个人周邮件预约

本机读取成功后，通过已登录的 GitHub CLI 将预约保存到仓库 Secret `PERSONAL_WEEKLY_SCHEDULE`。内容只有版本、随机事件 ID、收件邮箱、额度名称、读取时间和恢复时间，不包含账号身份、用量或 Codex 登录令牌。此功能面向**自行管理仓库的使用者**，需要对自己配置的仓库有 Secrets 写权限；分发包不包含作者的 GitHub 登录状态、Brevo 密钥或个人邮箱，也不允许任意下载者写作者的提醒队列。

在私有 `~/.tibo-reset/monitor.config.json` 的 `weeklyCloud` 设置 `enabled`、`recipient`、`repository`、`ghExecutable`（GitHub CLI 的绝对路径）。本机菜单栏每 15 分钟读取并同步；「我的额度」显示同步成功、下次预约或失败提示，提供关闭/启用按钮。取消必须联网同步成功才生效；已提交的邮件或已在执行的云端任务不能撤回。迁移仓库前先在旧配置下关闭并确认取消成功。

云端每 15 分钟尝试执行，正常到点后单独向本人发送一封邮件，电脑关机不影响已同步的预约。GitHub 调度和投递可能延迟，不能保证精确到分钟。邮件说明“已到记录时间”，不宣称已实际到账。关机期间若实际时间提前/改变，云端无法知道，仍按最后同步的预约执行。到点后超过 24 小时的旧预约不再补发。

只预约已用比例大于 0 的有效未来七天窗口：未使用的独立额度可能返回随查询移动的占位时间，不作为可靠预约。每次读取到新的时间替换未来旧预约；同账号刚到期的预约保留最多 24 小时，避免下一周期的读取抢先覆盖尚待云端发信的旧周期。切换账号或明确退出登录后同步取消旧预约；临时网络错误保留已同步预约并在界面提示。下一周期需要至少一次新的本机有效读取，不自动无限加七天。

云端先将随机事件 ID 的领取状态提交到仓库，再调用 Brevo，防止重跑重复发送。发送结果不明时标记待核查，不盲目重发；工作流报错供维护者处理。Secret 上传超时也会保留原事件 ID，重试不会创建另一个相同预约。个人任务先于公开推文任务运行，镜像不可用不阻止到点邮件；双方错误均在工作流中报告。

图标改为静态黑底白色 T!；菜单栏无需动画或常驻浏览器。macOS 本机安装位置为 `~/Applications/token重置.app`，打开后点击屏幕顶部 T! 查看面板。关闭面板继续监控；退出应用停止本机读取，但不取消已同步的云端预约。


0.8 验证记录：118 项自动化测试（7 项 TypeScript + 111 项 Python）通过；[云端预约检查](https://github.com/Brandon030722/token-reset/actions/runs/34446883800)成功读取一条未来预约，提前发送数为 0，Brevo 就绪。模拟时钟覆盖本机六天无读取后到点发送、去重、提前改期、取消、上传超时和发送结果不明。真实未来到期发送尚未发生。预约卡片经过常规宽度与 360 px 窄窗口检查，说明使用可展开区域。
