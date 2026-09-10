# Token重置邀请邮件服务

**部署状态：已上线；真实邀请码验证、邮箱确认及专用名单已接通。** 这份代码不能仅靠 GitHub Pages 运行。服务和权限验证使用 Workers + D1；公开动态监控仍由原 GitHub Actions 负责。

## 边界

- `GET /subscribe`：邀请订阅页，供网站用户打开。
- `POST /v1/subscribe`：校验服务端邀请码，向指定邮箱发送一次确认邮件。返回的设备 token 处于待确认状态。
- 确认链接使用 URL fragment，不进入服务器 URL 日志。GET 只显示确认页，POST 才激活；邮件扫描器不能通过打开链接完成订阅。
- 每次注册/新设备都要重新确认邮箱；知道他人的邮箱及邀请码也不能取得他的授权。
- `GET /v1/status`、`POST /v1/schedule` 使用设备 Bearer token。预约只能发给该 token 所属的已确认邮箱；忽略客户端传入的收件人。
- `POST /v1/cancel` 和邮件中的退订链接取消全部邮件。服务端撤销所有设备、停止预约，并移出 Brevo 邀请名单。已提交邮件无法撤回。
- 一码绑定一个邮箱：首次确认时原子绑定；待确认申请不占用名额。同一邮箱可在多台设备验证，退订不会释放邀请码。已有已确认设备继续有效，旧共享码不再接受新申请。
- 管理员可将 invitations.revoked 设为 1 停止该码后续验证；这不撤销已确认订阅。

## 部署

1. 登录 Cloudflare **Workers Free**，不购买套餐。
2. `npm ci`。把 `wrangler.example.jsonc` 复制为 `wrangler.jsonc`（已被忽略）。
3. `npx wrangler login`，创建 D1 数据库，把实际 ID 写入配置。
4. `npx wrangler d1 migrations apply token-reset-mail --remote --config wrangler.jsonc`。
5. 在 Brevo 创建新的专用名单，**不能绑定任何公开表单**。配置 `BREVO_LIST_ID`、已验证的 `BREVO_FROM_EMAIL` 和服务的 `PUBLIC_ORIGIN`。
6. 通过 Wrangler Secret stdin 设置 `BREVO_API_KEY`、至少 32 字符随机 `RATE_SALT`。不能把实际值放进源码、命令行参数或聊天。
7. `npm test`，`npx wrangler deploy --config wrangler.jsonc`。
8. 用管理员授权的测试邮箱验证拒绝错误邀请码、邮箱确认、个人预约、投递及退订，再切换原云端仓库的 `BREVO_LIST_ID` Secret 到新名单，并关闭旧表单。经人工确认的已有订阅可由管理员迁入；不能无条件复制陌生联系人。
9. 桌面 `public/config.json` 写入 `{"mailServiceUrl":"https://实际服务域名"}`；网站 `subscriptionUrl` 指向该域名的 `/subscribe`。

## 存储与运行

D1 私有保存邮箱、token 摘要、确认状态和预约。随机 scope 区分本机账号变更，不上传 Codex 凭据、账号 ID 或额度用量。邀请码只存 SHA-256 摘要及绑定关系；明文仅保存在管理员的私有签发文件中。不要公开 D1 导出或本机 `mail-session.json`。

服务端对 IP、单邮箱注册和每日投递做限额；当前确认信与个人周信总计最多 200 封/日，个人周信每邮箱每天最多 4 封。发信前检查 Brevo Free 额度。旧公共群发共享 Brevo 额度，可能被耗尽；不自动付费。

每 15 分钟检查，单轮最多 25 个到期预约；GitHub Actions 和邮件投递均可能延迟。预约只接受新近读取的一周窗口，不根据七天周期无限生成。**开源客户端无法证明其时间确实来自 Codex**，因此服务器限制只能通知该已确认邮箱，并限制发送频率。

重复上传以订阅、随机范围、窗口及时间去重；投递前先在数据库原子领取。超时后标记 `needs-review`，不自动重发。关闭预约、退订与正在执行的投递之间有短暂竞争，已进入投递的邮件不能撤回。

测试使用真实 SQLite、虚拟时钟及模拟 Brevo，不向外发送邮件：`npm test`。

参考：[Workers 免费额度](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 文档](https://developers.cloudflare.com/d1/)、[Brevo Contacts API](https://developers.brevo.com/reference/create-contact)。

## 签发邀请码

在 service 目录使用 `node scripts/issue-invites.mjs --remote --count 10` 签发 10 个独立邀请码。需要管理员 Cloudflare 登录权限；不设公开管理接口。省略 `--remote` 仅操作本地数据库。

首次升级先应用迁移，再使用 `--existing --count 10` 为历史已确认邮箱生成专属绑定码，并生成 10 个未使用码。重复执行不会给已有有效绑定码的邮箱再次签发。老用户无需重新订阅，新设备使用其专属码确认邮箱。

明文输出到仓库忽略的 `.local/invite-service/invites-*.json`，权限为仅本人可读写。只把单个未使用码交给对应用户，不分发整个文件。`pending` 表示上传结果未确认，应核对同目录 SQL 中的摘要后再使用；不要盲目重发整批。旧 `INVITE_CODE` Secret 已不再参与验证，可删除。
