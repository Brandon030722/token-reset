> 新版邀请制邮件服务代码已加入 [service](service/README.md)，部署及真实收信验证尚未完成。启用后由云端校验邀请码和邮箱，旧版本地邀请码及公开表单不能作为授权。

> 当前邮件方案已改为 Brevo Free，详细步骤见 [Brevo 配置指南](docs/email-brevo.md)。原 MailerLite 实现保留兼容，下面的 MailerLite 说明只适用于旧配置。邀请码为本地内测入口门槛，不是服务端鉴权。

# Token重置 / Tibo 观察站

> 本地应用已独立至 [token-reset-desktop](https://github.com/Brandon030722/token-reset-desktop)，从 **v0.1.0** 开始单独发布与维护。本仓库继续负责网站、云端监控和发信；已有 Secrets 与个人预约仍保留在这里。下方桌面相关内容为拆分前的历史说明。

本地应用名为 **Token重置**，保留原创 T! 图标；网页观察站继续使用原来的名称。

一个独立公益项目：读取 **@thsottiaux** 的公开动态，整理 Codex 额度重置线索，在有界时间内的**信号评分达到 80 分** 时提供 macOS 本机系统通知，或向已确认订阅的用户发送邮件。

前端使用 **ark-ui / POPUCOM / moderate（泡姆第二档）**：暖白底、蓝黄强调、圆角按钮、粗描边和轻微偏移阴影。没有使用游戏原版标志、素材或字体。用户指定的 ark-ui 和 terra-faction-ui 已分别安装；当前页面按泡姆家族设计，不混入泰拉阵营风格。

## 现在能做什么

- 响应式观察站：信号评分、事件档案、证据原帖、方法说明、个人恢复时间本机保存。
- 真实数据与演示模式分开。没有足够证据时显示“暂不估计”，不补造分数；数据过期或来源失败时暂停当前预测。
- Python 标准库监控引擎：RSS/Atom、至多三个来源合并核对及降级、转推/引用过滤、SQLite 去重、事件归并。
- A：macOS 菜单栏插件，默认无窗口、无 Dock 图标，按需打开系统 WebView 内置前端；Windows 仍是独立窗口。两者每 15 分钟启动一次监控 helper，执行完退出。
- B：GitHub Actions 每 15 分钟尝试运行，状态持久化，发布静态文件到 GitHub Pages。
- macOS 系统本地通知与 Brevo 订阅邮件独立；本地提醒无需邮箱，邮件仍使用托管订阅表单及后台 campaign 接口。
- 同一事件最多提交一次发送。启动时已有历史事件只建档、不补发。发生超时或进程中断时，优先防重复，可能漏发，需人工核查。

桌面架构采用 **macOS AppKit 菜单栏 + 按需 WKWebView / Windows WPF + WebView2**。macOS arm64 前端已在本机读取真实数据，菜单栏版本的资源占用与通知体验需单独验证；Windows 原生壳尚未在 Windows 编译和实机验证，也尚未实现菜单栏模式。云端部署与每周提醒配置见 [0.7 说明](docs/cloud-and-weekly.md)。Brevo 已在本机完成真实邮箱收信、双重确认、退订与恢复订阅验证；源码示例与分发包默认关闭发信，管理员私有配置另行启用。自动化回归测试使用模拟接口。网页中的演示数据始终带标签，不参与系统通知或发信。

## 免费与网络：实际边界

| 环节 | 当前方案 | 边界 |
| --- | --- | --- |
| 网页 | GitHub Pages | 公开仓库的常规免费方案；国内网络可达性不保证 |
| 定时 | 公共仓库的标准 Actions runner | 常规公开仓库使用免费；私有仓库有分钟数配额，不保证长期零成本 |
| 推文 | FxEmbed RSS；可配置 Nitter | 非官方、可能失效/限流/滞后/缺帖；不使用 X 官方 API |
| 评分 | 本地规则 | 无大模型或 API 调用费用；无法把规则数字当成统计概率 |
| 邮件 | Brevo Free（MailerLite 为兼容选项） | 当前配置使用免费 API；按服务返回额度检查，默认超过 100 名订阅者暂停群发；不保证长期零成本 |
| 桌面 | 系统 WebView + 短时 Python helper | 不随包分发完整浏览器；Windows 小包需要 .NET 8 Desktop Runtime 和 WebView2 Runtime；休眠期间不能准时检查 |

Brevo 的账号、专用名单、双重确认、邀请码与免费额度配置见 [邮件配置](docs/email-brevo.md)。MailerLite 兼容接口仍保留，但是否支持 HTML campaign API 取决于其账号权限；不要为本项目自动购买套餐。

FxEmbed 最新文档已提供 [账号 RSS/Atom](https://docs.fxembed.com/guide/advanced/rss-atom-feeds/)，不再仅限已知单条链接。公开 Nitter 实例状态可参考 [官方实例目录](https://github.com/zedeus/nitter/wiki/Instances)，配置前自行核实可用性及使用要求。

## 开发网页与单次采集

开发环境：Node.js 24、Python 3.12。下面的 Vite 服务用于网页开发；原生应用的启动与打包见下一节。

~~~sh
npm ci
npm run dev
~~~

打开终端显示的本机地址（默认 http://127.0.0.1:5173）。生产构建：

~~~sh
npm test
npm run build
~~~

只采集一次，不发信：

~~~sh
cp monitor.config.example.json monitor.config.json
python3 -m monitor --once --dry-run
~~~

Windows 使用 python 代替 python3。网页数据写入 public/data；本机状态在 .local/state.sqlite3。首次采集先建立历史基线，不追发旧事件；要测试通知逻辑运行自动测试，不要删除正式状态库重试。

monitor.config.json 已加入 .gitignore。需要降级来源时，在 feeds 数组加入经核实可用的 Nitter RSS，例如 https://YOUR-NITTER-HOST/thsottiaux/rss。默认只启用已核对的 FxEmbed feed。最多三个 URL，每个超时 12 秒，不绕过登录、验证码或拒绝访问页面。

浏览器开发版的“刷新消息”只读取本机已导出的数据。原生应用的“立即检查”通过系统桥接启动 helper；两者均受监控器的 15 分钟间隔保护，定时任务迟到时可能跳过过密的一轮。

## A：Windows / macOS 本地运行

macOS 默认以菜单栏插件运行，需要查看时再打开泡姆前端；Windows 使用独立应用窗口。两者均**不启动本地 HTTP 服务，也不需要用户另开浏览器看主界面**。点击原帖和 Brevo 订阅页时才交给系统浏览器。

| 平台 | 默认形态 | 分发与运行依赖 |
| --- | --- | --- |
| macOS | 原创单色 T! 菜单栏图标；点击后按需创建 WKWebView | 当前构建 Apple Silicon arm64；壳目标 macOS 13，最低系统版本仍需目标设备验证；Python helper 随包携带 |
| Windows | .NET 8 WPF + WebView2 独立窗口，尚无菜单栏模式 | 默认 win-x64 小包需要 .NET 8 Desktop Runtime 与 Evergreen WebView2 Runtime；Python helper 随包携带 |

插件或应用启动时检查一次，以后约每 15 分钟启动 helper，运行完退出；空闲时没有常驻 Python 采集进程。电脑休眠期间不保证检查准时。macOS 关闭前端后继续监控并释放 WebView；Windows 关闭窗口仍会退出并停止检查。

**2026-09-10 本机 macOS arm64 实测：** 菜单栏启动空闲约 11–16 MiB 物理内存，CPU 采样接近 0%，没有 WebKit 或 Python 子进程常驻；安装包约 10 MB、应用约 21 MiB。数字来自系统 `footprint`，不是所有设备或打开面板后的占用上限。打开面板才创建 WebView，关闭时释放界面和临时 WebView 会话；采集时有短暂 helper 占用。主界面不监听本地 TCP 端口。菜单栏 T! 为原创单色图形，应用 ICNS/ICO 由原创 SVG 几何图形生成，没有远程图片、字体或动画资源依赖。

### macOS 菜单栏使用

启动后默认不显示窗口，也不出现在 Dock；在屏幕顶部菜单栏找到原创单色 **T!** 图标：

- 左击：打开内置观察站前端。
- 右击：打开菜单，可立即检查、暂停或恢复监控、管理系统通知、退出插件。
- 关闭前端窗口：继续后台检查，释放 WebView，保留菜单栏图标。
- 暂停：暂停插件轮询；恢复后继续按检查间隔运行。
- 退出：通过菜单结束插件及其定时检查。关闭前端窗口不等于退出。

### macOS 本机系统通知

本机提醒无需邮箱、订阅表单或 Brevo 账号。首次使用需要允许 macOS 的系统通知授权，可从菜单的系统通知项操作；通知显示还受系统通知设置与专注模式影响。

只有真实实时数据仍有效、来源状态正常、预测窗口未过期，且信号评分达到或超过 80 分 时，才考虑发出系统提醒。演示数据、过期数据、已完成或已撤回事件不提醒；首次启动只建立历史基线，不补发旧事件；同一事件去重，重复轮询或分数上下波动不会反复提醒。

系统通知与 Brevo 邮件是两条独立通道：允许本机通知不会启用邮件，邮件配置也不代表本机通知已获系统授权。规则评分未经统计校准，80 分不代表 80% 发生概率。Windows 当前尚未实现对应的系统通知与菜单栏体验。

本地面板使用简洁的 **Token重置** 界面：有界时间内的重置信号、采集状态、最近成功时间和折叠证据；保留原图标。网站首页与桌面面板分别渲染。

### macOS 构建与打开

开发机需要 Apple Silicon、Xcode Command Line Tools、Node.js 24 和 python3.12：

~~~sh
npm ci
bash scripts/build_macos.sh
open "artifacts/Token重置.app"
~~~

产物为 artifacts/Token重置.app 与 artifacts/token-reset-macOS-arm64.zip。打开后查看顶部菜单栏 T!，不会自动弹出窗口。移动时保留完整 .app。包采用本机 ad-hoc 签名，没有付费开发者签名或 Apple 公证；下载分发、通知授权和其他 macOS 版本仍需验证。

### Windows 构建与打开

Windows 开发机需要 .NET 8 SDK、Node.js 24、匹配目标架构的 Python 3.12：

~~~powershell
.\scripts\build_windows.ps1
# 需要把 .NET 运行时一起打包时：
.\scripts\build_windows.ps1 -SelfContained
~~~

默认生成 artifacts/TiboMonitor-win-x64.zip。解压完整目录，运行 TiboMonitor.exe。SelfContained 包更大，但不要求预装 .NET Desktop Runtime；两种包都依赖系统 WebView2。程序不会自动安装系统运行时，缺少 WebView2 时会显示微软官方下载入口。

Windows ARM64 可在匹配架构环境使用 -Runtime win-arm64；macOS 的 PyInstaller 不能直接生成 Windows helper。详细接口与验证步骤见 [Windows 说明](desktop/windows/README.md)。**目前没有 Windows 实机验证结果，不应把构建配置视为已通过测试的 Windows 安装包。**

本机系统通知已通过一次真实测试：系统授权成功，唯一测试通知被系统接收并进入通知中心。系统的专注模式、锁屏和屏幕共享设置仍决定横幅是否当场显示；“已提交”不等于用户已经看到。右键菜单中的测试通知带明确测试标签，不代表发现重置线索，也不触发邮件。诊断结果仅保存在本机 `~/.tibo-reset/notification-status.json`。

### 本机配置

数据保存在 ~/.tibo-reset（Windows 对应 %USERPROFILE%\.tibo-reset）。原生资源处理只提供打包前端、snapshot/health 两个公开 JSON 和订阅地址，API key 与 SQLite 不提供给网页。

把 monitor.config.example.json 复制为 ~/.tibo-reset/monitor.config.json。默认 sendEmail=false。若要本地自动发信，按 [Brevo 配置](docs/email-brevo.md) 填 apiKey/listId/fromEmail 和 mailProvider=brevo，并明确设置 sendEmail 和 optInConfirmed 为 true；**不要把密钥填进 example 文件或 public 目录**。Windows 壳忽略继承的 TIBO_SEND_EMAIL 环境开关；直接运行 CLI 时仍支持环境配置。订阅网页地址单独放入 ~/.tibo-reset/web.config.json：

~~~json
{"subscriptionUrl": "https://你的-Brevo-托管表单地址"}
~~~

macOS 的监控配置与系统通知授权彼此独立。系统定时任务始终读取 ~/.tibo-reset/monitor.config.json；如果应用另选了配置位置，两者不会自动同步。

### 无窗口的系统定时

macOS 仅关闭前端时菜单栏已经会继续监控，不需要额外安装系统任务。需要退出插件后仍独立采集，或在 Windows 关闭窗口后继续检查时，才需要手动安装系统任务。独立任务执行采集及已配置的邮件逻辑，不提供菜单栏插件的 macOS 系统通知。退出或暂停插件不会卸载已经安装的系统任务；要停止这些独立任务，使用对应移除命令。

安装脚本不会在构建或打开应用时自动执行。**指定已打包程序时，要传入 TiboMonitorHelper，不能传入 GUI 应用执行文件。** helper 每轮运行后退出，不会弹出应用窗口。

macOS 源码方式（需要 Python 与源码保留在原位置）：

~~~sh
python3 scripts/install_macos_schedule.py
python3 scripts/install_macos_schedule.py --remove
~~~

macOS 使用打包 helper，按 .app 实际存放位置调整路径：

~~~sh
python3 scripts/install_macos_schedule.py --executable \
  "/Applications/Token重置.app/Contents/Resources/monitor/TiboMonitorHelper"
~~~

Windows 源码方式：

~~~powershell
.\scripts\install_windows_schedule.ps1
.\scripts\install_windows_schedule.ps1 -Remove
~~~

Windows 使用打包 helper：

~~~powershell
.\scripts\install_windows_schedule.ps1 -Executable "C:\Apps\TiboMonitor-win-x64\monitor\TiboMonitorHelper.exe"
~~~

不要绕过系统执行策略；若策略阻止安装脚本，可在任务计划程序中手动配置 helper 的 --once 命令。当前用户须已登录，电脑须保持可运行；系统任务不保证休眠时准时检查。安装后保留应用与项目脚本目录，移动位置后重新安装任务。

### 自动构建

仓库的 **Build native desktop apps** 工作流支持手动构建 macOS arm64 和 Windows x64，分别执行 scripts/build_macos.sh 与 scripts/build_windows.ps1，ZIP 产物保留 7 天。工作流只构建、运行离线测试和检查 helper 帮助，不执行真实采集或发送邮件。

旧 desktop/launcher.py 是保留的早期调试入口，已不用于默认桌面流程或分发构建。

## B：GitHub Actions + Pages

1. 将本目录内容作为一个独立仓库的根目录，默认分支为 main。推荐公开仓库；不要把整个“日常使用”目录上传。
2. 仓库 Settings → Pages → Build and deployment，Source 选择 GitHub Actions。
3. 允许 Actions 对仓库内容写入；若 main 受保护，需要为状态提交配置合适权限，否则持久化失败会阻止发信。
4. 首次手动运行 **Cloud monitor and email**。它随后按 UTC 每小时第 7、22、37、52 分钟尝试检查。另行运行 **Publish website** 发布网页；网页从仓库公开导出读取更新。
5. 将 Brevo 托管表单 URL 写入 public/config.json 的 subscriptionUrl 并提交。没有配置时按钮明确提示尚未开放。

可选 Repository Variables：`TIBO_FEED_URLS`（1–3 个 HTTPS RSS/Atom URL 的 JSON 数组）、`TIBO_MAIL_PROVIDER=brevo`、`BREVO_OPT_IN_CONFIRMED=true`、`TIBO_SEND_EMAIL=true`。未完成真实订阅验证前不要开启发送。

Repository Secrets：`BREVO_API_KEY`、`BREVO_LIST_ID`（仅已确认订阅者的专用列表）、`BREVO_FROM_EMAIL`（已验证发件邮箱）。MailerLite 的兼容变量由工作流保留，使用前需核实相应权限。

状态库 .monitor/state.sqlite3 和 public/data 会自动提交到仓库。库中只有公开推文/事件/去重状态及 campaign ID，没有订阅邮箱或 API key。**不要把用户邮箱加入该库。** 同一仓库的 workflow 串行执行；每次外部邮件操作前会提交并推送发送状态，持久化失败即停止操作。不要在其他仓库或本地同时给同一订阅组运行另一个独立发送器：两份数据库不能跨机器去重。

GitHub 的定时任务可能延迟或丢弃，公开仓库长期无活动也可能暂停，见 [schedule 官方说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。这不是可靠的实时监控服务。费用规则见 [Actions 计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

来源失败时保留上次 snapshot，更新 health 并提交，再把本次 workflow 标为失败以便维护者发现。网页从公开导出读取数据，并根据成功检查时间自动判定过期；网页构建和邮件监控相互独立。

## MailerLite 上线前的实际配置

1. 创建专用订阅组、托管订阅表单，启用 double opt-in。不要导入无订阅授权的联系人。
2. 验证发件地址/域名，并在账号中配置真实的发件组织及地址信息。
3. 将托管表单连接到该专用组；用自己的测试邮箱完成确认、退订测试。
4. 核实账号是否允许 campaign HTML API 和即时发送。文档中的付费限制未满足时保持 sendEmail 关闭。
5. 配置 token、专用组及发件地址，启用发送开关。新发生、首次达到阈值的事件才会触发。

邮件包含规则评分、截止时间、原帖依据和 MailerLite 退订标记。API 返回已受理不等于送达收件箱；投递、退信和退订在 MailerLite 后台查看。代码不会读取或导出订阅名单。

有 needs-review、creating、created、scheduling 状态时，不会自动重试。维护者在 MailerLite 用 campaign 名称 tibo-reset:事件ID 核查是否已创建/发送；有 campaign ID 时优先按 ID 查。确认状态后再决定是否人工处理，**不要直接清空 alerts 表或重新建库**。

## 评分方法与局限

**80 是提醒门槛，不是计算出来的发生概率。** 当前 `rules-v2` 的 85 分要求同一语句具备 Codex 额度重置、明确承诺、广泛适用人群与有界时间；任一条件不足就不能触发广泛提醒。广泛指全体用户或全体付费用户，后者必须显示“不代表免费用户适用”。45/55/60 等等级不具有百分比含义；低分不会按推文数量累加到 80。

- 回复中自足、明确的承诺可以识别；引用、条件、否定、问句和特定套餐/地区不会仅因出现 all/everyone 就提升到广泛提醒。
- today/tonight/within 24 hours 采用原帖起算最多 24 小时的观察上限；tomorrow/48 hours 最多 48 小时。作者时区未知，所以“今天”不是精确的当地日历截止。重复轮询与重复承诺不延长窗口。
- 小范围重置/补偿单独归档；明确公告可发 macOS 本机通知，邮件仍只按广泛重置信号判断。同一 post ID 去重，但不同帖描述同一补偿事件仍可能分别提醒。
- 完成、撤回、过期停止该次提醒。多个事件无法关联的线索保留为待核对；识别到原帖编辑则暂停该事件提醒。人工核对目前需维护者处理，没有审核后台。
- 第三方镜像无法保证完整性或真实性。英语规则有漏判和误判；当前没有经过验证的历史准确率，也不具备真正的概率预测能力。
- 为兼容已有 JSON，`probability24h` / `probability48h` 仍保留旧字段名；界面仅使用后者展示信号评分，新增 `scoreType=ordinal-rule-score`、`calibrated=false`。旧版 `rules-v1` 缓存不能用于发送。

逐项问题、修复、复现案例和历史回测方案见 [2026-09-10 全链路审计](docs/audit-2026-09-10.md)。**本地与云端只能选一个作为同一订阅名单的发信端**：各自的 SQLite 无法跨机器去重。不要清空正式数据库测试提醒。

## 测试

npm test 覆盖 Python 与前端数据协议、真实/演示隔离、过期、去重、首次启动、取消/完成、邮件超时、错误收件人组、持久化失败、引用过滤和进程锁。所有发送测试使用模拟接口，不向真实用户发邮件。

## 使用范围与第三方数据

本项目用于公开信息的个人学习研究，使用第三方镜像，不属于 X 官方 API，也不隶属于 OpenAI。第三方来源可能失效、限流、滞后、缺失或提供错误信息，国内直连情况因网络而异。

使用前应核对 X 及镜像提供方的服务条款和适用要求；不得把“公开可见”或本 README 当作自动采集授权。不要绕过访问控制，不要高频、大规模滥用，也不要将未经授权取得的数据用于商业分发。免责声明不消除使用者的责任。

项目代码采用 MIT；第三方内容、标志和服务的权利不随代码许可转移。


### 0.4 紧凑面板

默认 460 × 520 窗口，提供概览、动态、提醒三个标签页；邮件订阅入口回到前端，使用本机 web.config.json 中的 subscriptionUrl 打开 Brevo 托管确认表单。未配置时明确提示尚未连接，不采集邮箱或启用后台发信。系统通知测试、权限检查和演示切换位于提醒页的高级选项；菜单栏中的测试与监控配置也收进高级子菜单。授权状态不代表横幅已经显示。

## 0.7 云端与每周额度

菜单栏面板新增「我的额度」：自动读取本机 Codex 实际七天窗口，显示剩余额度和服务恢复时间，并发本机系统提醒。云端负责公共公告邮件，电脑关机也能继续运行；个人每周额度保存在本机。全流程目标检查间隔为 15 分钟。详细行为、关机限制和配置见 [云端与每周额度说明](docs/cloud-and-weekly.md)。


## 0.8 关机也能收到个人周提醒

启用个人云端预约后，本机将实际读取的下一次恢复时间和本人邮箱保存到 GitHub Secret，云端到点单独发邮件，无需等本机重新开机。个人用量和 Codex 登录凭据不上传。界面提供同步状态与关闭按钮；已用额度为 0 的窗口不预约，下一周期需本机重新读取，不能自动假定每七天循环。此模式需要使用者自己的仓库管理权限和 GitHub CLI 登录。详细配置、取消和延迟限制见 [云端与每周额度说明](docs/cloud-and-weekly.md#08-个人周邮件预约)。

应用与菜单栏采用黑底白字 T! 静态图标。macOS 可从 `~/Applications/Token重置.app` 打开，或用 Spotlight 搜索“Token重置”。
