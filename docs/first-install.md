# Bamboo 首次安装指引

Bamboo 是一款免费的 Mac Parquet 数据工作台。你可以查看数据、运行 SQL，或连接 Amazon S3、Cloudflare R2；不需要安装数据库或开发工具。

## 1. 确认你的 Mac 可以使用

- **芯片：Apple Silicon**，例如 M1、M2、M3、M4 等。
- **系统：macOS 12 或更新版本**。

点击屏幕左上角 ** → 关于本机**，查看“芯片”和 macOS 版本。目前的安装包不支持 Intel Mac、Windows 或 Linux。

## 2. 下载并安装

1. 打开 [Bamboo 官方 GitHub 下载页](https://github.com/OldPanda/bamboo/releases/latest)。
2. 在 **Assets（资源）** 中下载以 **`.dmg`** 结尾的文件。不要下载 `Source code`，那是开发者使用的源代码。
3. 双击下载的 DMG，把 **Bamboo** 图标拖到 **Applications（应用程序）** 文件夹。
4. 等待复制完成，在 Finder 侧栏推出 Bamboo 安装磁盘。
5. 打开 Finder 的“应用程序”，双击 **Bamboo**。

## 3. 如果 macOS 提示无法验证开发者

当前发布版本尚未经过 Apple 公证，首次打开时可能出现“无法验证开发者”或“Apple 无法检查其是否包含恶意软件”的提示。

确认文件来自上面的官方 GitHub Release 后，按以下步骤操作：

1. 先尝试打开一次“应用程序”中的 Bamboo；出现验证提示后关闭该提示。
2. 打开 **系统设置 → 隐私与安全性**，向下滚动到“安全性”。较旧的 macOS 中，对应位置可能是“系统偏好设置 → 安全性与隐私 → 通用”。
3. 找到关于 Bamboo 的提示，点击 **仍要打开（Open Anyway）**。
4. 根据系统提示使用 Touch ID 或输入 Mac 登录密码验证身份，然后在确认窗口点击 **打开（Open）**。

> 这是为你选择的这个应用添加例外，不需要关闭 Gatekeeper，也不需要在终端执行命令。不要把登录密码发到 GitHub 或聊天中。

**没有看到“仍要打开”？** 先确认刚刚尝试过打开 Bamboo，再回到设置查看。由单位或学校管理的 Mac 可能限制此操作，需要联系管理员。

**提示文件已损坏，或“会损坏你的电脑”？** 不要套用上面的放行步骤。重新从官方 Release 下载；如果仍然发生，请保留提示文字，到 [GitHub Issues](https://github.com/OldPanda/bamboo/issues) 报告。

界面名称和提示文字可能随系统版本不同。可参考 [Apple 官方：在 Mac 上安全地打开 App](https://support.apple.com/zh-cn/102445)。

## 4. 打开第一份数据

### 本地文件或文件夹

- 将 `.parquet` 文件拖进欢迎页的大框，松手后打开。
- 或点击 **Open data（打开数据）→ 本机**，选择一个文件或文件夹。
- 打开文件后，可以直接预览、筛选、排序和查看字段。

想试一下 SQL？输入下面的查询，点击 **Run query（运行查询）**：

```sql
SELECT * FROM data LIMIT 100;
```

`data` 代表当前文件。文件夹工作区还支持跨文件查询，例如：

```sql
SELECT * FROM workspace."orders.parquet" LIMIT 100;
```

请把 `orders.parquet` 换成工作区内实际存在的文件名。

### 云端文件

点击 **Open data（打开数据）→ 云存储**，选择 **Amazon S3** 或 **Cloudflare R2**，填写对应的连接信息。建议使用限定到所需存储桶或前缀的只读凭据；凭据保存在 Mac 钥匙串中。

连接配置说明：[Amazon S3](../S3_WORKSPACES.md) · [Cloudflare R2](../R2_WORKSPACES.md)。

## 后续更新和常用设置

- **更新**：Bamboo 可以后台检查新版本，在左下角提示。点击后按提示确认安装和重启；应用不会在使用过程中替你静默升级。也可以在 **设置 → 通用** 中手动检查。更新通过官方 GitHub Releases 提供。
- **语言和外观**：在 **设置 → 通用** 中选择中文或英文，以及浅色、深色或跟随系统。
- **大文件**：按需读取可以快速显示首屏，不代表所有完整扫描或复杂查询都同样快。可在 **设置 → 性能** 中调整查询内存、临时磁盘预算和超时。
- **原文件**：数据查询是只读的；导出 CSV 或 JSON 会创建新文件。

## 需要帮助？

- 发现 Bug：[GitHub Issues](https://github.com/OldPanda/bamboo/issues)。
- 使用问题、建议和想法：[GitHub Discussions](https://github.com/OldPanda/bamboo/discussions)。

反馈时写清 **Bamboo 版本、macOS 版本、芯片型号、操作步骤和报错文字**。截图前请隐去个人路径、密钥和业务数据，不要上传私人文件。
