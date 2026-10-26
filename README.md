# 智能记账 · 截图自动记账 + 付款通知自动记账

一个**纯静态、无后端**的记账网站：上传微信支付 / 支付宝 / 中国银行动账通知的截图，自动识别金额、时间、商户并记账，提供每日 / 每周 / 每月收支可视化，支持手动增删改和数据备份。

**安卓 App 版**更进一步：自动监听微信支付 / 支付宝 / 银行 App 的付款通知，**付款瞬间自动记账**，无需截图。代码在本仓库，GitHub Actions 自动打包 APK；数据保存在手机本地 SQLite，**不上传任何服务器**。

## ✨ 功能

- 🔔 **付款通知自动记账（安卓 App）**：支付成功即自动记一笔，支持微信支付、微信收款助手、支付宝、中国银行动账通知
- 📷 **截图自动记账**：支持微信「账单详情」、支付宝「账单详情」、中国银行 App「动账通知」页截图，中英文界面均可
- 🤖 **双识别引擎**：
  - **本地识别**（默认）：Tesseract.js 浏览器内 OCR，免费、离线、零配置
  - **AI 识别**（可选，更准）：智谱 GLM-4V-Flash 免费视觉模型，设置页填入自己的 API Key 即可
- ✅ **识别结果人工确认**：保存前可修改任何字段；重复上传同一张截图会提示去重
- 📊 **可视化统计**：今日 / 本周 / 本月汇总，按日 / 周 / 月收支柱状图、支出分类环形图、结余趋势线
- ✏️ **手动记账**：增删改、按月浏览、按收支筛选
- 💾 **数据备份**：一键导出 JSON，导入时自动去重合并或整体覆盖
- 📱 **PWA**：手机浏览器打开后可「添加到主屏幕」，像 App 一样全屏使用

## 📱 安卓 App：付款通知自动记账

网页（哪怕装成 PWA）没有权限读取系统通知，所以通知监听通过本仓库 `android/` 目录的安卓 App 实现。App 界面就是本网站本身（构建时自动打包进去），只是数据层换成了手机本地 SQLite。

### 下载安装

1. 打开本仓库 GitHub 页面 → **Releases**（右侧或顶部标签），下载最新的 `app-release.apk`
   - Releases 尚未发布时：**Actions** 标签 → 最新一次 `build` 运行 → 页面底部 Artifacts 下载 `smart-ledger-apk`（zip 解压得到 APK）
2. 手机上点开 APK 安装，允许「安装未知来源应用」（个人自用应用未上架应用商店，属正常流程）
3. 打开「智能记账」App → 设置 → **通知自动记账** → 点「去开启通知使用权」→ 在系统设置里找到「智能记账」并允许

之后正常用微信 / 支付宝付款，账单会自动出现，付款当时 App 弹出"✓ 已自动记账"；App 没打开时通知也**不会丢**（先暂存数据库，下次打开自动合并）。

### 使用前提与注意事项（重要）

- **微信支出**：通知来自「微信支付」服务号，需保持微信消息通知开启；**微信收款**（商家码）需关注「微信收款助手」并开启其通知
- **锁屏通知**需设为「**显示详细内容**」，否则锁屏期间的付款通知不含金额、无法解析（设置 → 通知 → 锁屏通知）
- **防杀后台**：小米/华为/OPPO/vivo 等系统会杀掉后台应用，请在电池/省电设置里把「智能记账」设为**不限制/允许后台运行**（各品牌路径不同，搜索"后台运行"+手机品牌即可）
- 通知栏通常没有交易单号，去重按「金额+分钟+商户」进行：同一分钟内两笔完全相同的消费会被认为重复（可在明细页手动补记）
- 好友聊天里提到"支付了xx元"不会被记录：只认「微信支付」「微信收款助手」「支付宝」等官方通知
- **数据与隐私**：账单只存在手机 App 私有数据库中，无任何联网上传；导出备份在「设置 → 导出备份」，文件写入手机「下载」目录

### 从源码构建（可选）

不需要 Android Studio：push 到 main 后 GitHub Actions 自动完成单测与打包（见 `.github/workflows/android.yml`）。本地构建命令：

```bash
cd android
gradle test            # JVM 单测（通知解析器）
gradle assembleRelease # 产出 app/build/outputs/apk/release/app-release.apk
```

签名密钥 `android/ledger.keystore` 随仓库分发（个人侧载用途，保证以后升级安装签名一致；介意的话请自行更换并注意：更换后需卸载重装）。

## 🚀 网页版部署到 GitHub Pages（约 3 分钟）

1. **注册/登录 GitHub**，点右上角 **+** → **New repository**
   - 名称随意（如 `my-ledger`），选择 **Public**（免费账户 Pages 需要 Public）
   - 勾选 **Add a README file**，点 **Create repository**
2. **上传本文件夹全部文件**（`test/` 目录是开发测试用的，无需上传）
   - 在仓库页面点 **Add file → Upload files**，把 `index.html`、`css/`、`js/`、`icons/`、`manifest.json`、`sw.js`、`README.md` 拖进去（保持文件夹结构）
   - 点 **Commit changes**
   - > 熟悉 git 的话也可以：`git init && git add -A && git commit -m "init" && git remote add origin <仓库地址> && git push -u origin main`
3. **开启 Pages**
   - 仓库页 **Settings → Pages**（左侧 Code and automation 下）
   - Source 选 **Deploy from a branch**，Branch 选 `main` / `root`，点 **Save**
   - 等 1~2 分钟，顶部会显示访问地址：`https://<你的用户名>.github.io/my-ledger/`
4. **手机使用**：把地址发到手机微信/备忘录，浏览器打开，建议「添加到主屏幕」

> 更新网站内容后重新 push/上传文件即可，Pages 会自动更新（可能有 1~2 分钟缓存）。

## 📖 使用说明

### 自动记账

1. 打开微信「我 → 服务 → 钱包 → 账单」点开某笔账单，或支付宝「我的 → 账单」点开明细，或中国银行 App 消息里的「动账通知」，**截图**
2. 回到本站点「上传支付截图」（可一次选多张）
3. 确认识别出的金额 / 分类 / 商户，点保存

### 启用 AI 识别（推荐，准确率接近 100%）

智谱官方接口不允许网页浏览器直连（跨域限制），所以 AI 识别需要两步配置：**① 申请 API Key + ② 免费部署一个转发代理（约 3 分钟，一次性）**。

**① 申请 API Key（免费）**

1. 打开 [bigmodel.cn](https://bigmodel.cn) 注册智谱开放平台账号
2. 控制台 → 「API Keys」→ 创建并复制（`glm-4v-flash` 模型免费，日常记账零成本）

**② 部署 Cloudflare Worker 代理（免费，无需信用卡）**

1. 打开 [dash.cloudflare.com](https://dash.cloudflare.com) 注册/登录 → 左侧 **Workers 和 Pages** → **创建 Worker**
2. 名称随意（如 `zhipu-proxy`）→ 点**部署**→ 再点**编辑代码**，把下面代码全部粘贴进去，点**部署**：

```js
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    }
    const url = new URL(request.url);
    const resp = await fetch('https://open.bigmodel.cn' + url.pathname, {
      method: request.method,
      headers: { 'Content-Type': 'application/json', 'Authorization': request.headers.get('Authorization') || '' },
      body: request.method === 'GET' ? undefined : await request.text()
    });
    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(resp.body, { status: resp.status, headers });
  }
};
```

3. 部署完成后会得到地址 `https://zhipu-proxy.你的名字.workers.dev`
4. 回到本站「设置」：识别方式选 **AI 识别**，粘贴 **API Key**，「代理地址」填 `https://zhipu-proxy.你的名字.workers.dev/api/paas/v4`，点**测试**显示 ✓ 即可

> Worker 每天免费额度 10 万次请求，个人记账绰绰有余。Key 和代理地址都只存在你手机浏览器里，Worker 只做透传不存任何数据。
> 不想配置代理的话，本地识别开箱即用，功能完全一样，只是识别精度略低（金额数字较准，个别中文字可能识别错，保存前确认即可）。

### 数据备份（重要！）

数据存在浏览器本地，**清除浏览器数据 / 换手机会丢失**。请定期：

- 「设置 → 导出备份」下载 JSON 文件保存到网盘或电脑
- 换设备时「导入恢复」，选择「合并」（自动去重）

## 🗂 目录结构

```
├── index.html        # 页面
├── css/style.css     # 样式（自适应深色模式）
├── js/
│   ├── app.js        # 主逻辑（含安卓通知记账钩子 __onAutoBill）
│   ├── ocr.js        # 本地 OCR（Tesseract.js）
│   ├── aiocr.js      # AI 识别（智谱 GLM-4V-Flash）
│   ├── parser.js     # 截图文本解析（微信/支付宝/中行，中英文兼容）
│   ├── store.js      # 数据层（localStorage / 安卓 SQLite 桥自适应、去重、导入导出）
│   ├── categories.js # 分类规则
│   └── charts.js     # ECharts 图表
├── vendor/echarts.min.js  # ECharts 本地副本（离线/弱网兜底）
├── manifest.json / sw.js / icons/   # PWA
├── android/          # 安卓 App（Kotlin，无第三方运行时依赖）
│   └── app/src/main/java/com/liujinwei/ledger/
│       ├── MainActivity.kt        # WebView 容器 + 备份导出
│       ├── LedgerListenerService.kt # 通知监听（通知使用权）
│       ├── NotifParser.kt         # 通知文本解析（与网页 parser 同源规则）
│       ├── JsBridge.kt            # window.AndroidStore JS 桥
│       ├── Db.kt                  # SQLite（bills/pending/capture_log）
│       ├── Bill.kt / Cats.kt      # 记录模型 / 自动分类
│       └── src/test/…             # JVM 单测（真实通知样例）
└── .github/workflows/android.yml  # CI：单测 + 打包 APK + Release
```

网页版与 App 共用同一份前端代码：安卓构建时由 Gradle 任务 `copyWeb` 自动把根目录网页复制进 assets，改网页后重新打包 App 即同步生效。

## ❓ 常见问题

- **本地识别首次很慢？** 首次需从 CDN 下载 OCR 引擎和中文模型（约 7MB），之后有缓存，秒开。
- **识别错了？** 保存前所有字段都可修改；追求准确请按上文配置 AI 识别。
- **AI 测试提示跨域失败？** 智谱官方接口不允许浏览器直连，属正常现象——按上文「② 部署 Cloudflare Worker」配置代理地址后即可。
- **App 没有自动记账？** 按顺序检查：①设置页「通知自动记账」是否显示已开启；②系统通知里锁屏是否显示详细内容；③微信/支付宝自身的通知权限是否开启；④是否被系统省电杀掉（见上文防杀后台）。设置页「最近捕获」能看到每条通知的处理结果（已记录/重复/未识别）。
- **最近捕获里显示「未识别」？** 表示这条通知是付款相关通知、但没有解出金额。常见原因：①锁屏通知设置了「隐藏内容」，通知里根本没有金额；②通知只是"您有一条新的服务通知，点击查看"这类提示；③遇到了新的文案格式。v1.1.1 起「未识别」日志会附上通知原文片段，把它截图反馈到 Issues 即可快速适配。
- **通知标题是"Service Accounts"（服务号聚合）？** 微信把服务号消息（含微信支付）合并进「服务号」聚合通知，此时官方名在正文开头而非标题。v1.1.1 起已支持识别这种格式。
- **网页版和 App 数据互通吗？** 各自独立（网页存在浏览器 localStorage，App 存在手机 SQLite），通过「导出备份 / 导入恢复」互传，格式完全一致。
