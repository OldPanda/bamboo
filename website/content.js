/** Shared copy for static HTML generation and browser language switching. */
export const siteOrigin = "https://getbamboo.app";
export const pageMetadata = {
  en: {
    title: "Bamboo — Open-source Parquet viewer and SQL workbench",
    description:
      "Explore Parquet files with Bamboo, a free, open-source desktop SQL workbench. Preview local, Amazon S3 and Cloudflare R2 data and query it on your device.",
    locale: "en_US",
    image: `${siteOrigin}/assets/bamboo-en-light-f277933fc4b586f1.png`,
    imageAlt:
      "Bamboo SQL workbench showing a query on synthetic Parquet orders data",
  },
  zh: {
    title: "Bamboo — 开源 Parquet 查看器与 SQL 工作台",
    description:
      "Bamboo 是免费的开源桌面 Parquet 查看器与 SQL 工作台。预览本地、Amazon S3 和 Cloudflare R2 文件，在自己的设备上用 SQL 探索数据。",
    locale: "zh_CN",
    image: `${siteOrigin}/assets/bamboo-zh-light-2a213558990ae26a.png`,
    imageAlt: "Bamboo SQL 工作台：查询合成的 Parquet 订单数据",
  },
};
export const translations = {
  downloadChooseLabel: { zh: "查看所有下载", en: "View all downloads" },
  t0: { zh: "跳转至正文", en: "Skip to content" },
  t1: { zh: "功能介绍", en: "Features" },
  t2: { zh: "安装指引", en: "Installation" },
  t3: { zh: "常见问题", en: "FAQ" },
  t4: { zh: "下载", en: "Download" },
  t5: { zh: "让 Parquet 数据，", en: "Parquet data," },
  t6: { zh: "变得", en: "made " },
  t7: { zh: "触手可及。", en: "accessible." },
  t8: {
    zh: "打开文件，看见数据，写下你的第一条 SQL。",
    en: "Open a file, see your data, write your first SQL query.",
  },
  t9: {
    zh: "从本地到云端，把探索数据的时间，还给你。",
    en: "From local files to the cloud, spend more time exploring.",
  },
  t10: { zh: "免费下载 macOS 版", en: "Download for macOS" },
  t11: { zh: "首次安装指引", en: "First-time installation" },
  t12: {
    zh: "· Apple Silicon · macOS 12+ · MIT 协议",
    en: "· Apple Silicon · macOS 12+ · MIT License",
  },
  t15: {
    zh: "文件在哪里，工作台就在哪里。",
    en: "Where your files are, your workbench follows.",
  },
  t16: { zh: "本地文件与文件夹", en: "Local files and folders" },
  t17: {
    zh: "少一点准备，多一点发现",
    en: "Less setup. More discovery.",
  },
  t18: { zh: "你的文件，你的 SQL。", en: "Your files. Your SQL." },
  t19: { zh: "一个轻巧的工作台。", en: "One lightweight workbench." },
  t20: {
    zh: "不必先建库、写脚本。打开 Parquet，就能开始探索。",
    en: "No database setup or scripts. Open Parquet and start exploring.",
  },
  t21: { zh: "会写 SQL，就会用。", en: "Know SQL? You're ready." },
  t22: {
    zh: "预览行、查看字段、筛选与排序。用熟悉的 SQL 做关联和聚合，跨文件查询，再把结果导出为 CSV 或 JSON。",
    en: "Preview rows, inspect columns, filter and sort. Join and aggregate with familiar SQL, query across files, and export results as CSV or JSON.",
  },
  t23: { zh: "本地", en: "Local" },
  t24: {
    zh: "本地、云端，一样顺手。",
    en: "Local or cloud. Equally simple.",
  },
  t25: {
    zh: "打开电脑上的文件或整个文件夹，也能直接连接 Amazon S3 和 Cloudflare R2。多个工作区，在同一个窗口里切换。",
    en: "Open a file or an entire folder on your Mac, or connect directly to Amazon S3 and Cloudflare R2. Switch between workspaces in one window.",
  },
  t26: {
    zh: "打开并返回前 100 行，不含界面绘制。本地为历史 3 次中位数；S3 / R2 均为随机顺序 5 轮中位数。云端含连接初始化，未控制缓存与网络。",
    en: "Open + first 100 rows; excludes UI rendering. Local: historical median of 3. S3 / R2: medians of 5 randomized rounds each. Cloud includes connection setup; caches and network uncontrolled.",
  },
  t27: { zh: "文件大小", en: "File size" },
  t28: { zh: "本地耗时", en: "Local time" },
  t29: { zh: "S3 耗时", en: "S3 time" },
  t30: { zh: "R2 耗时", en: "R2 time" },
  t32: { zh: "大文件，秒开预览。", en: "Big files. Fast previews." },
  t33: {
    zh: "按需读取需要的数据，不用先把整个文件塞进内存。GB 级文件也能快速看见首屏，内存与临时磁盘预算由你掌握。",
    en: "Read only the data you need without loading the whole file into memory. Preview GB-scale files quickly, with control over memory and temporary disk budgets.",
  },
  t34: {
    zh: "从下载，到第一条查询",
    en: "From download to your first query",
  },
  t35: {
    zh: "几步，开始读懂你的数据。",
    en: "A few steps to understand your data.",
  },
  t36: {
    zh: "选择平台，查看系统要求与首次安装步骤。",
    en: "Choose a platform for requirements and first-time installation.",
  },
  t38: { zh: "下载 Bamboo", en: "Download Bamboo" },
  t39: { zh: "点击", en: "Click " },
  t40: { zh: "，获取", en: " to get the " },
  t41: {
    zh: "安装文件。M1、M2、M3、M4 等 Apple 芯片 Mac 均属于 Apple Silicon；目前不提供 Intel 版。",
    en: " installer. M1, M2, M3, M4 and other Apple Silicon Macs are supported; there is no Intel build yet.",
  },
  t42: { zh: "拖入「应用程序」", en: "Drag to Applications" },
  t43: {
    zh: "双击下载的 DMG，把",
    en: "Double-click the downloaded DMG, then drag ",
  },
  t44: { zh: "拖到", en: " into " },
  t45: { zh: "Applications（应用程序）", en: "Applications" },
  t46: {
    zh: "。复制完成后，推出安装磁盘，从「应用程序」打开 Bamboo。",
    en: ". Once copying finishes, eject the installer disk and open Bamboo from Applications.",
  },
  t47: { zh: "打开文件，写下 SQL", en: "Open a file. Write SQL." },
  t48: { zh: "将", en: "Drag a " },
  t49: {
    zh: "文件拖进欢迎页的大框，或点击",
    en: " file into the welcome drop zone, or click ",
  },
  t50: { zh: "Open data（打开数据）", en: "Open data" },
  t51: {
    zh: "。也可以选择文件夹，或连接 S3 / R2 工作区。",
    en: ". You can also open a folder or connect an S3 / R2 workspace.",
  },
  t52: {
    zh: "第一次打开被 macOS 拦住？看这里。",
    en: "Blocked by macOS on first launch? Start here.",
  },
  t53: {
    zh: "当前版本尚未经过 Apple 公证，首次打开时可能提示“无法验证开发者”或“Apple 无法检查其是否包含恶意软件”。确认你从本页链接的 GitHub Release 下载后，可以按以下步骤允许打开。",
    en: "The current release is not Apple-notarized. On first launch, macOS may say the developer cannot be verified or Apple cannot check it for malicious software. After confirming you downloaded it from the GitHub Release linked here, follow these steps to allow it to open.",
  },
  t54: {
    zh: "先从「应用程序」打开一次 Bamboo；若出现验证提示，关闭该提示。",
    en: "Try opening Bamboo from Applications once. If a verification alert appears, dismiss it.",
  },
  t55: { zh: "打开", en: "Open " },
  t56: {
    zh: "系统设置 → 隐私与安全性",
    en: "System Settings → Privacy & Security",
  },
  t57: {
    zh: "，向下滚动到“安全性”（旧版系统可能在“安全性与隐私 → 通用”）。",
    en: " and scroll to Security (older versions may use Security & Privacy → General).",
  },
  t58: {
    zh: "找到关于 Bamboo 的提示，点击",
    en: "Find the message about Bamboo and click ",
  },
  t59: { zh: "仍要打开（Open Anyway）", en: "Open Anyway" },
  t60: {
    zh: "按系统要求验证身份，再在确认窗口点击",
    en: "Verify your identity if requested, then click ",
  },
  t61: { zh: "打开（Open）", en: "Open" },
  t62: { zh: "macOS 真实界面 ·", en: "Actual macOS interface · " },
  t63: { zh: "图片来源：Apple 支持", en: "Image: Apple Support" },
  t64: {
    zh: "。图中的“示例 App”在安装时对应 Bamboo。",
    en: ". The “Example App” shown here represents Bamboo during installation.",
  },
  t65: {
    zh: "如果没有出现“仍要打开”，先确认刚刚尝试过打开 Bamboo；受单位管理的 Mac 可能需要管理员协助。若系统提示“会损坏电脑”或文件已损坏，请停止打开，重新从 Release 下载，仍有问题可到 GitHub Issues 反馈。",
    en: "If Open Anyway is missing, first make sure you just attempted to open Bamboo. Managed Macs may require an administrator. If macOS says the app will damage your computer or is damaged, stop and download it again from Releases. Report persistent problems on GitHub Issues.",
  },
  t66: {
    zh: "查看 Apple 官方说明 ↗",
    en: "Read Apple's instructions ↗",
  },
  t67: { zh: "你可能还想知道", en: "A few things you may wonder" },
  t68: {
    zh: "常见问题，有问有答",
    en: "Common questions. Clear answers.",
  },
  t69: {
    zh: "支持哪些系统和文件格式？",
    en: "Which platforms and file formats are supported?",
  },
  t70: {
    zh: "Bamboo 支持 macOS Apple Silicon、Windows x64 和 Linux x64。正式下载以页面底部下载区和 GitHub Releases 为准；预览构建不等于正式发布。不提供 Intel Mac 或 Windows/Linux ARM64 安装包。macOS 要求 12 及以上，可在  → 关于本机查看芯片与系统版本。支持读取 Parquet，并将结果导出为 CSV 或 JSON。",
    en: "Bamboo supports macOS on Apple Silicon, Windows x64 and Linux x64. Published downloads are shown in the downloads section at the bottom of this page and GitHub Releases; preview builds are not stable releases. No Intel Mac or Windows/Linux ARM64 packages are provided. macOS requires version 12 or later; check your chip and OS under  → About This Mac. Read Parquet files and export results as CSV or JSON.",
  },
  t71: {
    zh: "文件需要上传吗？云端凭据放在哪里？",
    en: "Do files need uploading? Where are cloud credentials stored?",
  },
  t72: {
    zh: "Bamboo 没有后端服务器，不会接收或存储你的文件、SQL、查询结果或云端凭据。所有查询和数据处理都在你的电脑本地完成，应用配置也保存在本机。连接 S3 或 R2 时，由你的电脑直接按需读取你自己的云端存储；访问凭据保存在本机的系统凭据库中：macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service。",
    en: "Bamboo has no backend server and does not receive or store your files, SQL, query results, or cloud credentials. All queries and data processing run locally on your computer, and app settings stay on your device. For S3 or R2, your computer reads directly from your own cloud storage on demand. Access credentials stay in your system vault: macOS Keychain, Windows Credential Manager or Linux Secret Service.",
  },
  t73: {
    zh: "打开文件后，第一条 SQL 怎么写？",
    en: "What should my first SQL query look like?",
  },
  t74: { zh: "对当前文件，输入", en: "For the current file, enter " },
  t75: {
    zh: "，点击 Run query（运行查询）即可。文件夹工作区支持跨文件查询，例如",
    en: " and click Run query. Folder workspaces support queries across files, for example ",
  },
  t76: {
    zh: "。你也可以直接预览、筛选和排序，不必先写 SQL。",
    en: ". You can also preview, filter and sort without writing SQL.",
  },
  t79: {
    zh: "会修改打开的 Parquet 文件吗？",
    en: "Will Bamboo modify the Parquet files I open?",
  },
  t80: {
    zh: "不会。Bamboo 以只读方式打开和查询 Parquet 文件，预览、筛选、排序和 SQL 查询都不会修改原文件。导出结果会创建新文件。",
    en: "No. Bamboo opens and queries Parquet files in read-only mode. Previewing, filtering, sorting and SQL queries leave the original file unchanged. Exporting results creates a new file.",
  },
  faqUpdateQuestion: {
    zh: "如何更新 Bamboo？",
    en: "How do I update Bamboo?",
  },
  faqUpdateAnswer: {
    zh: "macOS 版 Bamboo 可以在后台检查更新，有新版本时会在左下角提示。点击更新提示，按提示确认安装并重新启动即可；你也可以在「设置 → 通用」中手动检查更新。安装和重启都需要你主动确认，不会在使用过程中自动升级。更新从本项目的 GitHub Releases 获取。Windows/Linux 的「检查更新」会打开版本页面，由你手动下载和安装。",
    en: "On macOS, Bamboo can check for updates in the background and notify you in the lower-left corner. Click the update notification and follow the prompts to confirm installation and relaunch. You can also check manually in Settings → General. Installation and relaunch always require your confirmation; Bamboo will not automatically upgrade while you work. Updates come from this project's GitHub Releases. On Windows/Linux, Check for updates opens the releases page for manual download and installation.",
  },
  t81: {
    zh: "Bamboo 收费吗？遇到问题在哪里反馈？",
    en: "Is Bamboo free? Where can I give feedback?",
  },
  t82: {
    zh: "Bamboo 免费开源，采用 MIT 许可证。发现 Bug 可以到",
    en: "Bamboo is free and open source under the MIT license. Report bugs on ",
  },
  t83: {
    zh: "；使用问题、想法和建议欢迎到",
    en: "; ask questions and share ideas on ",
  },
  t84: {
    zh: "讨论。反馈时请注明应用版本、操作系统版本和重现步骤，并隐去密钥、私人路径和业务数据。",
    en: ". Include your app version, operating system version and steps to reproduce, and remove secrets, private paths and business data.",
  },
  t85: { zh: "一起，让它更好用", en: "Make it better, together" },
  t86: {
    zh: "有问题，或有个好主意？",
    en: "A question or a good idea?",
  },
  t87: {
    zh: "到 GitHub 留下你的反馈。",
    en: "Leave your feedback on GitHub.",
  },
  t88: {
    zh: "一次讨论，也可能成为 Bamboo 的下一个小进步。",
    en: "A conversation could spark Bamboo's next improvement.",
  },
  t89: {
    zh: "报告 Bug · 提交具体问题",
    en: "Report a bug · Describe a problem",
  },
  t90: { zh: "提问交流 · 分享想法", en: "Ask questions · Share ideas" },
  t91: {
    zh: "下一份数据，已经准备好了",
    en: "Ready for your next dataset",
  },
  t92: {
    zh: "免费开源。为你的数据，也为你的好奇心。",
    en: "Free and open source. For your data, and your curiosity.",
  },
  t93: { zh: "版本记录 ↗", en: "Release history ↗" },
  t94: { zh: "使用条款", en: "Terms of Use" },
  t95: { zh: "关闭 ×", en: "Close ×" },
  t96: {
    zh: "生效日期：2026 年 10 月 29 日",
    en: "Effective: October 29, 2026",
  },
  t97: {
    zh: "本条款适用于 OldPanda 维护的 Bamboo 官网及其分发的 Bamboo 应用。使用前请阅读以下说明。Bamboo 是一个用于打开和查询 Parquet 数据的开源桌面工具。",
    en: "These terms cover the Bamboo website maintained by OldPanda and the Bamboo application it distributes. Please read them before use. Bamboo is an open-source desktop tool for opening and querying Parquet data.",
  },
  t98: { zh: "1. 开源许可", en: "1. Open-source license" },
  t99: {
    zh: "Bamboo 软件按",
    en: "Bamboo software is provided under the ",
  },
  t100: {
    zh: "提供。使用、修改和分发软件的权利以该许可证为准；本条款不限制 MIT 授予的权利。第三方组件、商标及图片保留各自的许可和权利，不因 Bamboo 的开源许可而一并授权。",
    en: ". Your rights to use, modify and distribute it are governed by that license; these terms do not restrict the rights granted by MIT. Third-party components, trademarks and images retain their respective licenses and rights and are not all covered by Bamboo's license.",
  },
  t101: {
    zh: "2. 数据与使用责任",
    en: "2. Your data and responsibilities",
  },
  t102: {
    zh: "请仅打开你有权访问的文件和云存储，并遵守适用法律以及存储服务商的条款。你负责管理访问凭据、授权范围、数据备份及导出文件。云服务商可能对请求、存储和数据传输收费，相关费用由你的服务协议决定。",
    en: "Only access files and cloud storage you are authorized to use, and follow applicable laws and your storage provider's terms. You are responsible for credentials, access scopes, backups and exported files. Cloud providers may charge for requests, storage and transfers under your service agreement.",
  },
  t103: {
    zh: "3. 功能、性能与更新",
    en: "3. Features, performance and updates",
  },
  t104: {
    zh: "功能和支持范围以当前发布版本为准。文件结构、设备、缓存和网络会影响性能；网站中的测试数据并非对所有文件或环境的速度承诺。Bamboo 可以自动检查新版本，安装更新和重启始终需要你主动确认。",
    en: "Features and support depend on the installed release. File structure, hardware, caches and network affect performance; website benchmarks are not speed guarantees for every file or environment. Bamboo may check for new versions automatically, but installation and restart always require your confirmation.",
  },
  t105: { zh: "4. 按现状提供", en: "4. Provided as is" },
  t106: {
    zh: "在适用法律允许的范围内，Bamboo 按现状提供，不承诺持续可用、完全无错误或适合特定用途；软件相关的保证及责任限制以 MIT License 为准。请独立核验重要查询结果。本条款不排除法律规定不可放弃的权利或责任。",
    en: "To the extent allowed by applicable law, Bamboo is provided as is, without a promise of continuous availability, freedom from errors or suitability for a particular purpose. Software warranties and liability limitations are governed by the MIT License. Independently verify important query results. These terms do not exclude rights or liabilities that cannot legally be waived.",
  },
  t107: { zh: "5. 外部服务", en: "5. External services" },
  t108: {
    zh: "GitHub、Amazon S3、Cloudflare R2、Apple 及其他外部服务由各自运营者提供，其条款与隐私政策另行适用。列出这些服务不代表双方存在合作或背书关系。",
    en: "GitHub, Amazon S3, Cloudflare R2, Apple and other external services are operated independently, under their own terms and privacy policies. Mentioning them does not imply partnership or endorsement.",
  },
  t109: { zh: "6. 变更与联系", en: "6. Changes and contact" },
  t110: {
    zh: "条款调整会在此更新日期，新的说明不追溯削减已取得的开源许可权利。关于网站或产品的问题，请通过",
    en: "Changes will be dated here and will not retroactively reduce your existing open-source license rights. For questions about the website or product, contact the maintainer through ",
  },
  t111: { zh: "或", en: " or " },
  t112: {
    zh: "联系维护者。公开反馈中请勿附带密码、密钥或个人数据。",
    en: ". Do not post passwords, keys or personal data in public feedback.",
  },
  t113: { zh: "隐私政策", en: "Privacy Policy" },
  t114: {
    zh: "本说明描述 OldPanda 维护的 Bamboo 官网和当前 Bamboo 桌面应用如何处理信息。Bamboo 不要求注册账号，当前应用没有使用情况统计、广告追踪或自动上传诊断报告的功能。",
    en: "This notice explains how the Bamboo website maintained by OldPanda and the current desktop application handle information. Bamboo requires no account. The current application has no usage analytics, advertising tracking or automatic diagnostic-report uploads.",
  },
  t115: { zh: "1. 浏览官网", en: "1. Visiting this website" },
  t116: {
    zh: "官网不包含统计脚本、广告、追踪像素或反馈表单，也不设置追踪 Cookie。浏览器的 localStorage 仅用于保存你选择的语言与浅色或深色主题，不会由页面发送给维护者；你可以通过浏览器清除本站数据来删除这些偏好。",
    en: "The website has no analytics scripts, ads, tracking pixels or feedback form, and sets no tracking cookies. Browser localStorage remembers only your theme and language preferences; the page does not send them to the maintainer. Clear this site's browser data to remove these preferences.",
  },
  t117: {
    zh: "在线访问仍需要网络请求。网站托管商、CDN 或网络服务商可能处理 IP 地址、访问时间、请求网址、浏览器信息等常规请求元数据，用于内容交付、安全和运维；具体处理与留存取决于实际托管服务的配置和政策。这与页面是否加载统计脚本是不同的。",
    en: "Online visits still involve network requests. Hosting, CDN and network providers may process IP addresses, request times, URLs and browser information for delivery, security and operations. Processing and retention depend on the actual hosting configuration and provider policy, independently of whether the page includes analytics scripts.",
  },
  t118: {
    zh: "2. 文件、查询与本地保存",
    en: "2. Files, queries and local storage",
  },
  t119: {
    zh: "本地 Parquet 数据和 SQL 在你的设备上处理，不会上传给 Bamboo 维护者。应用会在本地保存设置、工作区路径、连接配置和 SQL 草稿；这些内容可能包含敏感信息。查询可能使用本地缓存及临时磁盘，导出结果保存在你选择的位置。异常退出后可能遗留临时数据。",
    en: "Local Parquet data and SQL are processed on your device and are not uploaded to the Bamboo maintainer. The app saves settings, workspace paths, connection configurations and SQL drafts locally; these may contain sensitive information. Queries may use local caches and temporary disk space, and exports are saved to your chosen location. Temporary data can remain after an abnormal exit.",
  },
  t120: {
    zh: "关闭工作区或卸载应用不一定清除已保存的配置、凭据、临时文件和导出结果。你可以在设置中删除不需要的云连接，并按需清理本机应用数据、系统凭据库条目和自行导出的文件。删除云连接不会删除云端对象。",
    en: "Closing a workspace or uninstalling the app does not necessarily remove saved configurations, credentials, temporary files or exports. Remove unwanted cloud connections in Settings and, as needed, clean up local app data, system credential entries and your exported files. Deleting a cloud connection does not delete cloud objects.",
  },
  t121: { zh: "3. 云存储连接", en: "3. Cloud storage connections" },
  t122: {
    zh: "只有连接你配置的 Amazon S3 或 Cloudflare R2 时，应用才会向相应服务发送经过身份验证的列举、元数据和文件读取请求。服务商会收到这些请求及必要的网络元数据，处理方式受你的云服务协议约束。文件查询在本机执行。",
    en: "Only when you connect configured Amazon S3 or Cloudflare R2 storage does the app send authenticated listing, metadata and file-read requests to that service. The provider receives those requests and necessary network metadata under your cloud service agreement. File queries execute locally.",
  },
  t123: {
    zh: "云访问凭据保存在系统凭据库：macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service；连接配置和 SQL 草稿保存在本机。凭据不发送给 Bamboo 维护者。请按最小权限配置只读凭据，并在不再需要时删除连接及撤销相应授权。",
    en: "Cloud credentials stay in the system vault: macOS Keychain, Windows Credential Manager or Linux Secret Service; connection configurations and SQL drafts stay on your device. Credentials are not sent to the Bamboo maintainer. Use least-privilege, read-only credentials, and delete connections and revoke access when no longer needed.",
  },
  t124: {
    zh: "4. 版本检查和下载",
    en: "4. Update checks and downloads",
  },
  t125: {
    zh: "macOS 版默认启用自动检查更新，可在 Settings → General 中关闭。Windows/Linux 不自动检查或下载安装更新；手动检查会在浏览器中打开版本页面。检查和下载通过 HTTPS 访问 GitHub Releases 及其下载基础设施；服务方会收到 IP 地址及版本检查所需的常规 HTTP 元数据。应用不会在检查中发送文件路径、查询内容、云凭据或 Sparkle 系统概况。安装和重启须由你主动确认。",
    en: "On macOS, automatic update checks are enabled by default and can be disabled in Settings → General. Windows/Linux do not automatically check, download or install updates; a manual check opens the releases page in your browser. Checks and downloads access GitHub Releases and its download infrastructure over HTTPS. These services receive IP addresses and normal HTTP metadata needed for update checks. The app does not include file paths, query contents, cloud credentials or Sparkle system profiles in these requests. Installation and restart require your confirmation.",
  },
  t126: {
    zh: "5. 主动反馈与外部链接",
    en: "5. Feedback and external links",
  },
  t127: {
    zh: "如果你在 GitHub Issues 或 Discussions 发布反馈，维护者及其他访客可能看到你的公开账号、文字和附件；内容可能被长期保留或被他人复制。请先移除密钥、私有路径和真实业务数据。不要公开提交安全漏洞的利用细节，请先阅读仓库的",
    en: "Feedback posted on GitHub Issues or Discussions may expose your public account, text and attachments to the maintainer and other visitors. It may be retained or copied by others. Remove keys, private paths and real business data first. Do not publicly post exploit details; read the repository's ",
  },
  t128: { zh: "安全说明", en: "security guidance" },
  t129: {
    zh: "点击 GitHub、X、Apple 等外部链接后，相应网站按自己的政策处理你的访问。GitHub 下载和反馈服务适用",
    en: "Visits to GitHub, X, Apple and other external links are governed by those sites' policies. GitHub downloads and feedback are subject to the ",
  },
  t130: { zh: "GitHub 隐私声明", en: "GitHub Privacy Statement" },
  t131: {
    zh: "6. 选择、联系与变更",
    en: "6. Your choices, contact and changes",
  },
  t132: {
    zh: "你可以不连接云服务、关闭自动检查更新、清除网站语言与主题偏好，并决定是否分享反馈。对于你主动提供给维护者的信息，如需请求访问、更正或删除，请通过项目的 GitHub 联系入口发起请求；请先仅描述请求，不要公开发布敏感信息。第三方平台的记录需同时通过其提供的渠道处理。",
    en: "You can avoid cloud connections, disable automatic update checks, clear website preferences and decide whether to share feedback. To request access, correction or deletion of information you voluntarily shared with the maintainer, contact the project through GitHub. Start by describing the request without publishing sensitive details. Records held by third-party platforms also require using their own request channels.",
  },
  t133: {
    zh: "本说明随产品实际行为更新，并在此标注日期。如果今后加入统计、账号或其他数据处理功能，会先更新本说明，并在适用时提供相应告知与选择。",
    en: "This notice will be updated and dated as the product changes. If analytics, accounts or other processing are added, this notice will be updated first, with appropriate information and choices where applicable.",
  },
  period: { zh: "。", en: "." },
  a135: { zh: "Bamboo 首页", en: "Bamboo home" },
  a136: { zh: "主导航", en: "Main navigation" },
  a137: { zh: "切换至深色主题", en: "Switch to dark theme" },
  a138: { zh: "切换明暗主题", en: "Switch light or dark theme" },
  a139: { zh: "展开导航", en: "Open navigation" },
  a140: { zh: "移动导航", en: "Mobile navigation" },
  a141: { zh: "Bamboo App 真实截图", en: "Real Bamboo app screenshot" },
  a142: {
    zh: "Bamboo App 浅色界面：打开 orders.parquet，用 SQL 筛选已完成订单，按金额降序查看结果。",
    en: "Bamboo light interface: orders.parquet, fulfilled orders filtered with SQL and sorted by amount.",
  },
  a143: {
    zh: "Bamboo App 深色界面：打开 orders.parquet，用 SQL 筛选已完成订单，按金额降序查看结果。",
    en: "Bamboo dark interface: orders.parquet, fulfilled orders filtered with SQL and sorted by amount.",
  },
  a146: {
    zh: "Query 通过 Bamboo 查询本地、Amazon S3 和 Cloudflare R2 文件",
    en: "Query local, Amazon S3 and Cloudflare R2 files through Bamboo",
  },
  a147: {
    zh: "Parquet 文件打开耗时对比",
    en: "Parquet file opening times",
  },
  a148: {
    zh: "macOS 隐私与安全性真实截图：安全性区域中，被阻止的应用右侧有“仍要打开”按钮",
    en: "Actual macOS Privacy & Security screenshot in English: Open Anyway appears beside the blocked app in the Security section",
  },
  a149: { zh: "下载 Bamboo", en: "Download Bamboo" },
  a150: { zh: "页脚导航", en: "Footer navigation" },
  a151: { zh: "关闭Terms · 使用条款", en: "Close Terms of Use" },
  a152: { zh: "关闭Privacy · 隐私政策", en: "Close Privacy Policy" },
  platformLabel: { zh: "选择电脑系统", en: "Choose your computer" },
  platformChoose: { zh: "请选择平台", en: "Choose a platform" },
  otherPlatforms: { zh: "其他平台：", en: "Other platforms:" },
  allPlatforms: { zh: "选择电脑系统：", en: "Choose your computer:" },
  downloadsHeading: { zh: "下载 Bamboo", en: "Download Bamboo" },
  packagemacosDmg: { zh: "DMG 安装包", en: "DMG installer" },
  packagewindowsSetup: { zh: "EXE 安装包", en: "EXE installer" },
  packagewindowsZip: { zh: "ZIP 便携包", en: "Portable ZIP" },
  packagelinuxDeb: { zh: "DEB 安装包", en: "DEB package" },
  packagelinuxTar: { zh: "tar.gz 便携包", en: "Portable tar.gz" },
  packageUnavailable: { zh: "尚未正式发布", en: "Not published yet" },
  macosPackageRequirements: {
    zh: "macOS 12+ · 不支持 Intel Mac",
    en: "macOS 12+ · Intel Macs not supported",
  },
  windowsPackageRequirements: {
    zh: "Windows 10/11 · 需要 WebView2",
    en: "Windows 10/11 · Requires WebView2",
  },
  linuxPackageRequirements: {
    zh: "Ubuntu 22.04 · GTK 3 / WebKitGTK 4.1",
    en: "Ubuntu 22.04 · GTK 3 / WebKitGTK 4.1",
  },
  releaseNotes: {
    zh: "版本说明与发布状态",
    en: "Release notes and availability",
  },
  windowsRequirementsTitle: { zh: "检查系统要求", en: "Check requirements" },
  windowsRequirements: {
    zh: "Windows 10/11 x64，需要 Microsoft Edge WebView2 Evergreen x64 Runtime；不提供 ARM64 或 32 位安装包。",
    en: "Windows 10/11 x64 requires Microsoft Edge WebView2 Evergreen x64 Runtime. No ARM64 or 32-bit package is provided.",
  },
  webviewLink: {
    zh: "从 Microsoft 获取 WebView2 ↗",
    en: "Get WebView2 from Microsoft ↗",
  },
  windowsInstallTitle: { zh: "安装或解压", en: "Install or extract" },
  windowsInstall: {
    zh: "运行 setup.exe 安装包，为当前用户安装；或完整解压便携 ZIP，再打开 Bamboo/bamboo.exe。请保留同目录的 extensions 和 licenses 文件夹。",
    en: "Run the setup.exe installer for the current user, or fully extract the portable ZIP and open Bamboo/bamboo.exe. Keep the extensions and licenses folders beside the executable.",
  },
  windowsLaunchTitle: { zh: "首次打开", en: "First launch" },
  windowsLaunch: {
    zh: "预览包尚未签名，可能显示 SmartScreen 警告。请先核对下载来源和版本说明；不要关闭系统保护。受管理的电脑请联系管理员。",
    en: "Preview packages are unsigned and may trigger SmartScreen. Check the download source and release notes before proceeding; keep system protection enabled. On a managed computer, contact your administrator.",
  },
  desktopCloudTitle: {
    zh: "云连接与后续更新",
    en: "Cloud connections and updates",
  },
  windowsCloud: {
    zh: "云访问凭据保存在 Windows 凭据管理器中。检查更新会打开正式版本页面，下载和安装由你手动完成。卸载前可先在 Bamboo 中删除不再需要的云连接。",
    en: "Cloud credentials stay in Windows Credential Manager. Check for updates opens the official releases page; you download and install updates manually. Remove unwanted cloud connections in Bamboo before uninstalling.",
  },
  linuxRequirementsTitle: { zh: "检查桌面环境", en: "Check your desktop" },
  linuxRequirements: {
    zh: "已在 Ubuntu 22.04 x64 验证；兼容 Debian 的桌面系统需要 GTK 3、WebKitGTK 4.1 和 libsecret。其他发行版未验证，不提供 ARM64 安装包。",
    en: "Validated on Ubuntu 22.04 x64. Compatible Debian desktops need GTK 3, WebKitGTK 4.1 and libsecret. Other distributions have not been validated; no ARM64 package is provided.",
  },
  linuxInstallTitle: { zh: "安装 DEB 或解压", en: "Install DEB or extract" },
  linuxInstall: {
    zh: "在下载目录使用以下命令安装 DEB，将文件名替换为实际下载的版本：",
    en: "In your download folder, install the DEB with this command, replacing the filename with the downloaded version:",
  },
  linuxPortable: {
    zh: "也可完整解压 tar.gz 并运行 Bamboo/bamboo。便携包不会安装系统依赖，请保留 extensions 和 licenses 文件夹。",
    en: "Alternatively, fully extract the tar.gz and run Bamboo/bamboo. The portable archive does not install system libraries. Keep the extensions and licenses folders.",
  },
  linuxLaunchTitle: {
    zh: "打开文件或连接云端",
    en: "Open files or connect to cloud",
  },
  linuxCloud: {
    zh: "本地文件可直接打开。云连接需要正在运行的用户 D-Bus 会话和已解锁的 Secret Service（例如 GNOME Keyring）；凭据库不可用时会提示错误，不会改用明文保存。",
    en: "Local files work independently. Cloud connections need an active user D-Bus session and an unlocked Secret Service, such as GNOME Keyring. Unavailable credential storage produces an error; credentials never fall back to plaintext.",
  },
  desktopUpdatesTitle: {
    zh: "后续更新与卸载",
    en: "Updates and uninstalling",
  },
  linuxUpdates: {
    zh: "检查更新会打开正式版本页面，下载和安装由你手动完成。卸载会保留设置和凭据；如不再需要，请先在 Bamboo 中删除云连接。",
    en: "Check for updates opens the official releases page; you download and install updates manually. Uninstalling keeps settings and credentials. Remove unwanted cloud connections in Bamboo first.",
  },
};
