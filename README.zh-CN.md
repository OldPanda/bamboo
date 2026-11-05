[English](README.md) | [简体中文](README.zh-CN.md)

<div align="center">

<img src="assets/bamboo.png" width="112" height="112" alt="Bamboo 标志" />

# Bamboo

### 探索本地与云端的 Parquet 数据。

**你的文件，你的 SQL，一个工作台。**<br>
浏览本地文件、Amazon S3 和 Cloudflare R2。<br>
使用 DuckDB 查询，无需将数据导入数据库。

![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple_Silicon-111111?logo=apple&logoColor=white)
![Windows x64](https://img.shields.io/badge/Windows-x64-111111)
![Linux x64](https://img.shields.io/badge/Linux-x64-111111?logo=linux&logoColor=white)
[![MIT 许可证](https://img.shields.io/badge/license-MIT-111111)](LICENSE)
[![已收录于 Awesome MyGo](https://awesomemygo.dev/badge.svg)](https://awesomemygo.dev/apps/bamboo)

**[下载](https://github.com/OldPanda/bamboo/releases/latest)** · **[安装指南](https://getbamboo.app/zh/docs/#installation)** · **[官网源码与部署](website/README.md)** · **[文档](#文档)** · **[参与开发](CONTRIBUTING.md)** · **[安全](SECURITY.md)**

</div>

## 功能

- **浏览文件。** 预览 Parquet 和本地 CSV/TSV，查看数据结构，按列排序和筛选。
- **跨文件查询。** 使用带行内补全的 SQL，进行关联查询与聚合。
- **分析与导出。** 查看列统计、生成透视表，导出完整结果或当前页。
- **连接存储。** 打开本地文件夹、S3 或 R2 工作区；云端凭据保存在系统凭据库中：macOS Keychain、Windows Credential Manager 或 Linux Secret Service。
- **继续上次的工作。** 同时打开多个文件，并恢复已保存的查询草稿。

## 快速开始

按操作系统下载[最新正式版](https://github.com/OldPanda/bamboo/releases/latest)：

| 平台                | 下载与安装                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS Apple Silicon | 下载 [DMG](https://getbamboo.app/zh/#download-macos)，将 Bamboo 拖入“应用程序”文件夹。                                                                                   |
| Windows x64         | 运行[安装 EXE](https://getbamboo.app/zh/#download-windows)，或解压便携版 [ZIP](https://getbamboo.app/zh/#download-windows)。                                             |
| Linux x64           | 在 Ubuntu 22.04+ 或兼容的 Debian 桌面系统安装 [DEB](https://getbamboo.app/zh/#download-linux)，或安装所需依赖后解压 [tar.gz](https://getbamboo.app/zh/#download-linux)。 |

系统要求与首次启动说明见[安装指南](https://getbamboo.app/zh/docs/#installation)。发布页提供各安装包的 SHA-256 校验和。

选择文件、文件夹或云端工作区，也可以将 Parquet、CSV 或 TSV 文件拖入欢迎区域。使用 `data` 查询当前文件，或使用 `workspace."orders.parquet"` 查询当前工作区中的文件。

## 从源码构建

macOS 工具链配置见[参与开发](CONTRIBUTING.md)，原生 x64 构建见 [Windows/Linux 构建说明](docs/windows-linux.md#build-and-verify)。在 macOS Apple Silicon 上，从仓库根目录执行：

```sh
npm ci
npm run build
open build/Bamboo.app
```

macOS 构建会按需下载 Go 1.27.3。本地 macOS 构建采用 ad-hoc 签名，未经公证。

## 文档

[中文用户文档](https://getbamboo.app/zh/docs/) · [跨文件 SQL](WORKSPACE_SQL.md) · [CSV / TSV](TEXT_FILES.md) · [数据分析](ANALYSIS.md) · [Amazon S3](S3_WORKSPACES.md) · [Cloudflare R2](R2_WORKSPACES.md) · [开发与测试](CONTRIBUTING.md)

## 许可证

[MIT](LICENSE)。基于 [MyGo](https://github.com/egoist/mygo) 和 [DuckDB](https://duckdb.org/) 构建。
依赖许可证见[第三方声明](THIRD_PARTY.md)。
