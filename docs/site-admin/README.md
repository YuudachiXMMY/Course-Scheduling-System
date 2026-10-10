# 官网运营控制台（/dashboard/site）联调与上线

ithacateens.com 的 `/admin`（询盘 / 订阅者 / 邮件群发 / 弹窗）已移植到本项目的
`/dashboard/site`，用本项目的**平台超级管理员**账号登录。

这五张表的数据**归属也一并迁了过来**：它们现在住在 `course_scheduling` 库里（迁移 `0025`），
本项目是唯一写入方。官网不再直连自己的 Prisma 表，改为服务端调用本项目的 `/api/site/*`。

> 历史数据不迁移。原 `ithacafa` 库里已有的询盘和订阅者留在原处（表不删，只是不再读写），
> 新控制台从零开始 —— 这是立项时明确接受的。

## 拓扑

```
                     ┌──────────────────────────────────────────┐
  访客 ──► ithacafo-web (SvelteKit)                              │
            │  POST /api/contact        ──X-Site-Secret──►       │
            │  POST /api/subscribe      ──X-Site-Secret──►  course-scheduling
            │  GET  /api/popups/active  ──X-Site-Secret──►  /api/site/*
            │     （60s 进程内缓存 + 失败软降级）                 │      │
            │                                                    │      ▼
            └── /admin/* ──302──► /dashboard/site ───────────────┘  course_scheduling 库
                                   （超管控制台）
```

- **写入路径硬失败**：本项目不可用时，官网表单返回 500。宁可让访客看到错误并重试，
  也不要静默丢掉一条询盘。
- **弹窗读取软降级**：它在官网每个公开页面的热路径上，失败时优先供陈旧值、否则当作"无弹窗"，
  绝不把首屏带下去。

## 一、本项目侧（已在本 PR 内）

1. 迁移：`npm run db:migrate`（新增 `0025_site_admin_tables.sql`，五张平台全局表）。
2. 环境变量（`.env` / `.env.extra`）：

   ```bash
   # 官网调用本项目写入端点的共享密钥。两边必须完全一致。
   SITE_INGEST_SECRET="$(openssl rand -base64 48)"

   # 邮件群发（Stalwart）。未配置时控制台可以存草稿，但发送会被明确拒绝（不会假装发成功）。
   SMTP_HOST="stalwart"          # 服务器上用内网别名（与本项目同在 proxy 网络）
   SMTP_PORT="465"               # 465 = 隐式 TLS
   SMTP_USER="noreply@ithacateens.com"
   SMTP_PASSWORD=""              # Stalwart 应用专用密码，不是登录密码
   SMTP_FROM="Ithaca Family Academy <noreply@ithacateens.com>"
   SMTP_TLS_INSECURE="1"         # ⚠️ 仅当 SMTP_HOST 是内网别名 stalwart 时才设
   ```

   > `SMTP_TLS_INSECURE` 只对内网别名 `stalwart` 生效。把它和一个公网主机名一起设，
   > 应用会**拒绝启动**（`src/lib/mail.ts` 的 `assertTlsConfigSafe`）——那是在一个本该能
   > 验证证书的链路上关掉校验，等于主动给中间人开门。

3. 部署（`IthacaServer/apps/course-scheduling/docker-compose.yml`）：把上面的变量加进
   `app.environment`。Stalwart 已经在共享的 `proxy` 网络上，而本项目的 app 容器也在
   `proxy` 上，所以**不需要新增网络**。

## 二、官网侧（`ItahcaFA-web`，用本目录的补丁）

```bash
cd /path/to/ItahcaFA-web
git checkout -b port-admin-to-scheduling
git apply /path/to/Course-Scheduling-System/docs/site-admin/ithacafa-web.patch
npm run check    # 验证过：0 errors 0 warnings
npx vitest run   # 验证过：330 passed
```

补丁内容（6 个文件，+339/−58）：

| 文件 | 改动 |
|---|---|
| `src/lib/server/site-api.ts` | **新增** —— 三个端点的带超时客户端 + `SiteApiError` |
| `src/routes/api/contact/+server.ts` | 两处 Prisma 写入 → 一次 `postContact()`（同事务）。限流 / CSRF / Turnstile / 双语确认信**一行未动** |
| `src/routes/api/subscribe/+server.ts` | P2002 那套 → `outcome` 三态判别式，409 与"仅插入方发欢迎信"逐字保留 |
| `src/lib/server/popup-cache.ts` | Prisma → fetch，并加失败软降级（供陈旧值 / 冷启动短 TTL 重试） |
| `src/hooks.server.ts` | `/admin/*` → 302 跳本项目控制台（`PUBLIC_SITE_ADMIN_URL` 未设则保持旧行为） |
| `.env.example` | 新增三个变量的说明 |

官网侧环境变量：

```bash
COURSE_SCHEDULING_API_URL="https://<排课系统域名>"   # 不带尾斜杠
SITE_INGEST_SECRET=""                                # 与本项目完全一致
PUBLIC_SITE_ADMIN_URL="https://<排课系统域名>/dashboard/site"
```

## 三、上线顺序（有依赖，别颠倒）

1. 本项目：跑迁移、配 `SITE_INGEST_SECRET`、部署。此时 `/api/site/*` 已就绪，
   官网还在走老路径，两边都正常。
2. 官网：配三个变量、应用补丁、部署。**切换在这一刻发生** —— 新的询盘/订阅开始进
   `course_scheduling` 库。
3. 验证（见下）。
4. 确认无误后再告诉运营方改用新控制台入口。

### 验证清单

- [ ] 官网联系表单提交一次 → `/dashboard/site/询盘` 里出现这条，且确认信照旧收到（双语）
- [ ] 官网订阅一次 → 收到欢迎信；**同一邮箱再订一次** → 返回 409 且**不再发**第二封欢迎信
- [ ] 新控制台建一个启用的弹窗 → 官网公开页面在 60 秒内出现它
- [ ] 把 `COURSE_SCHEDULING_API_URL` 临时指到一个不存在的地址 → 官网公开页面**仍能打开**
      （弹窗消失即为正确），而表单提交返回 500。这一条是在验证软降级/硬失败的分野
- [ ] 访问官网 `/admin` → 302 跳到新控制台
- [ ] 邮件群发：先建草稿，确认人数提示与订阅者数一致，再发一次小范围测试

## 四、已知事项

1. **弹窗生效延迟从"立即"变成"≤60 秒"。** 官网侧有 60 秒进程内缓存；原先在官网自己的
   `/admin` 改弹窗会同步调 `invalidatePopupCache()` 立即失效，现在控制台在另一个进程里，
   调不到。这是本次移植唯一的行为回退，已在控制台界面上写明。
   要恢复"立即"需要一个跨服务失效回调 —— 为一个 60 秒窗口引入这条耦合不值得。
2. **官网表单硬依赖本项目在线。** 这是选择"数据搬到 `course_scheduling`"时接受的代价。
   官网日志会把这类失败与自身 bug 分开打（`[contact] 落库失败（课程排课系统不可达或拒绝）`）。
3. **官网的 `/api/admin/*` 端点仍在，但已成死代码**（读的表不再有人写）。它们仍受会话保护，
   无安全影响。连同 `src/routes/admin/**` 一起删除，建议单独一个清理 PR —— 混进本次改动
   会让 diff 多出约 1700 行删除，没法好好审。
4. **官网 Prisma 里那五个 model 不删表。** 删除不可逆且没有收益；现有数据留在原处。

## 五、询盘资格字段（后续一笔）

`contact_messages` 有 `locale / grade / programs / topic / source / status / notes` 七个字段
（官网改版 PRD 加的，官网表单一直在写），但官网原来的 `/admin` 询盘页从来没展示过它们。
本次按严格对等移植：**列已建好、数据照常写入**，但列表只显示原有那几列。

后续要做的是：询盘列表展示这些字段 + `status` 三态分诊（`new` / `contacted` / `closed`）
+ `notes` 内部备注。数据已经在库里，纯 UI 工作。
