# UBSWH-StockCheck — independent Google test edition

独立项目，当前状态：本地测试通过，尚未创建 GitHub 仓库、Google 脚本部署或线上数据存储。
不要覆盖 UBSWH-3D，也不要修改当前 ChatGPT Sites 或已安装 APK。

## 已准备的文件

- `public/index.html`：独立扫描网页，沿用当前 v20 的业务规则。
- `public/manager.html`、`public/cin7.html`：管理入口，转到 Google 托管的管理页面。
- `public/config.js`：只填写**新项目**的 Apps Script `/exec` 地址。不放任何密码或密钥。
- `apps-script/Code.gs`：报告写入、校验、筛选、权限、初始化及库存读取。
- `apps-script/Shared.gs`：由现有盘点规则生成，保留数字精度与原 Google/Cin7 基准来源。
- `apps-script/Cin7.gs`：仅按所选 SKU 查询 Cin7 Available，含分页校验、限额及短时缓存。
- `apps-script/Manager.html`、`apps-script/Cin7.html`：登录和管理页面，运行在 Google HTML Service。
- `apps-script/appsscript.json`：Google V8 配置与权限声明。
- `.github/workflows/deploy.yml`：只允许在 `UBSWH-StockCheck` 仓库手动部署，发布 `public/` 目录，不发布服务器源码或配置密钥。
- `source/`：可维护前端及业务规则；`scripts/build.mjs` 重新生成网页与共享规则。
- `tests/`、`source/lib/*.test.mjs`：本地模拟 Google 服务测试和盘点规则回归测试。

管理页放在 Google 上，可使用 `google.script.run`，避免管理口令在 GitHub Pages 页面输入。扫描页保持 GitHub Pages，避免 Google iframe 改变 DT50 原生扫码适配。

## 独立存储与权限

初始化只会创建全新的 `UBSWH-StockCheck · Reports TEST` 表格及文件夹。
Google Sheets 保存报告索引，私有 Drive 文件保存每次完整 JSON。并发写入加锁，报告内容散列作为唯一 ID，网络重试返回原回执，不重复生成记录。文件已写入但索引失败时可重试恢复索引。

库存只读你原先发布的 Google 库存 CSV，采用 B 库位、C SKU、G Available；不写回库存表。
后台刷新缓存半小时，已有快照读取失败时明确标记 stale，扫描端阻止用过期快照开始新任务。手动刷新有频率保护。

扫描端免 Google 登录（需部署账户允许匿名访问）。管理员使用新项目独立管理口令，登录有效期8小时，服务端校验每次报告读取、导出与设置操作。管理口令初次设置不少于20字符，请使用随机生成的口令并通过私下渠道保管。
Cin7 凭证存放在新项目 Script Properties，不回传到页面或扫描器；这不是本程序自建的加密保险库，脚本项目编辑者可以接触这些配置。只给可信维护者脚本编辑权限。

## 部署顺序（不影响旧系统）

1. 创建名为 `UBSWH-StockCheck` 的新 GitHub 仓库。不要在 UBSWH-3D 仓库中上传这些文件。
2. 在你的 Google 账户中创建一个**全新的** Apps Script 项目，命名 `UBSWH-StockCheck TEST`。
3. 在新项目加入 `Code.gs`、`Shared.gs`、`Cin7.gs`，以及 HTML 文件 `Manager`、`Cin7`；将 `appsscript.json` 配置复制到新项目清单。不要修改原有脚本项目。
4. 在新脚本的“项目设置 → 脚本属性”设置 `ADMIN_PASSWORD` 为随机管理口令（不少于20字符）。不要将口令放进 GitHub 文件或对话中。
5. 从编辑器运行一次 `initializeStockCheck`，由你完成 Google 授权。它创建新表格和新文件夹，存入脚本属性，然后删除原始口令并保留盐化散列；重复运行会拒绝覆盖已有数据。
6. 在部署菜单新建“网页应用”：以部署者身份执行，访问范围选择能支持扫描同事免登录的选项。如果你的组织禁止匿名访问，先停下并调整访问方案，不要关闭组织安全策略。
7. 复制这次**新部署**的 `/exec` 地址到 `public/config.js`。不要填原 3D 项目的接口。
8. 上传项目到新 GitHub 仓库，在 Pages 设置选择 GitHub Actions；手动运行独立部署工作流。
9. 将新扫描网页实际地址填入 Apps Script 属性 `FRONTEND_URL`（只用于管理页面返回扫描端的链接）。不要猜测地址，以 GitHub 发布结果为准。
10. 先打开新扫描页，读取库存，选测试库位，按测试验收清单完成录入、上传、管理端查看。新报告只进入测试数据存储。
11. 需要测试 Cin7 时，在新 Google 管理页输入 Account ID / Key；保存本身不调用 Cin7。查询配额为本脚本30次/分钟、1000次/日；原系统及其他脚本的调用不计入此计数，仍共同占用 ERP 账户配额。

GitHub Pages 与 Google Apps Script 在浏览器中的跨域响应、组织权限、DT50 WebView 兼容性尚需真实部署验证。本地模拟测试不能证明这些环节已经可用。禁止使用 `no-cors` 或 JSONP 将读不到的响应当作成功回执。

## 开发与构建

需要 Node.js 22.13 或更高版本：

```sh
npm ci
npm run build
npm test
```

`source/` 是可编辑源文件；重新构建会覆盖 `public` 页面及 `Shared.gs`、Google管理HTML，但不会覆盖 `public/config.js`。
Google 代码改动后需更新 Apps Script 网页应用部署版本。GitHub 前端改动后需手动运行 Pages 工作流。

## 当前测试结果及未完成项

已通过53项本地自动测试（13项 Google 迁移及传输模拟、40项继承盘点规则）。包括零数量、完整报告校验、权限隔离、重复上传、写入中断恢复、分页、筛选及重置、前端空配置禁止发送、管理凭证不进入URL。
未进行任何真实 Google/Cin7 写入或调用，也未连接你的 GitHub 账号。本次没有迁移旧报告。
未生成新 APK；现有 APK 仍访问原系统。Google 版真机验收通过后，再更新独立测试 APK 的站点地址与可信来源配置；不得直接替换全部同事的现有 APP。

## 切换及回退

新旧系统独立，不双写。测试时注意不要把测试报告当生产数据。
旧系统历史报告保留在原管理端，不会自动出现在新后台。另行确认后再导出、校验、导入历史报告；索引和完整数据需要同时迁移，CSV 不能完整代替原始 JSON 审计元数据。
GitHub域名及APP存储隔离，原本机未上传记录不会自动复制。正式切换前先确保旧报告上传或导出。
随时可继续使用现有旧网页和旧 APK，无需停用它们进行测试。

## 平台依赖

此测试版运行代码不依赖 ChatGPT Sites。GitHub与Google本身的配额、权限、组织策略和服务条款仍适用，不保证永久免费或无限容量。报告表格当前按行读取并在服务端筛选，适合当前小规模测试，增长后应评估索引与归档。
