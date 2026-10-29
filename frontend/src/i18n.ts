/** Supported interface languages; persisted values use these stable identifiers. */
export type Language = "en" | "zh-CN";
type Params = Record<string, string | number>;
/** App-owned Chinese translations keyed by their English UI text. */
export const chinese: Record<string, string> = {
  "Temporary disk": "临时磁盘",
  "Automatic temporary disk": "自动临时磁盘",
  "Auto uses 25% of available space after reserving 1 GiB.":
    "预留 1 GiB 后，自动使用剩余可用空间的 25%。",
  "Available: {available} GiB · Maximum: {maximum} GiB · Reserve: {reserve} GiB.":
    "可用：{available} GiB · 上限：{maximum} GiB · 预留：{reserve} GiB。",
  "Disk space detection unavailable. Temporary disk use is disabled.":
    "无法检测磁盘空间，临时磁盘已停用。",
  "Set a custom limit of 0 to disable temporary disk use.":
    "自定义上限设为 0 可关闭临时磁盘。",
  "temporary disk limit exceeds currently available space":
    "临时磁盘上限超过当前可用空间",
  "temporary disk limit must be a non-negative supported GiB value":
    "临时磁盘上限必须是受支持的非负 GiB 数值",
  "Drop a Parquet file here": "将 Parquet 文件拖到这里",
  "Release to open Parquet": "松开以打开 Parquet",
  "Or open a file, folder, or cloud workspace.":
    "也可以打开文件、文件夹或云端工作区。",
  "Automatic query memory": "自动查询内存",
  "Query memory": "查询内存",
  Custom: "自定义",
  "Auto uses 25% of physical memory. Custom lets you choose the limit.":
    "自动使用物理内存的 25%，也可以自定义上限。",
  "This Mac: {total} GiB · Query budget: {budget} MiB ({percent}%).":
    "本机内存：{total} GiB · 查询预算：{budget} MiB（{percent}%）。",
  "Memory detection unavailable. Auto uses 256 MiB; custom limit is 16384 MiB.":
    "无法检测物理内存。自动模式使用 256 MiB，自定义上限为 16384 MiB。",
  "Above 75% of physical memory. This may slow down your Mac and other apps.":
    "超过物理内存的 75%，可能影响 Mac 和其他应用的流畅度。",
  "query memory must be at least 128 MiB and no greater than physical memory":
    "查询内存不得低于 128 MiB 或超过本机物理内存",
  Performance: "性能",
  "Query memory limit": "查询内存上限",
  "Temporary disk limit": "临时磁盘上限",
  "Query timeout": "查询超时",
  seconds: "秒",
  "Save changes": "保存更改",
  "Saved. Applies to the next query.": "已保存，下次查询生效。",
  "⌘ + Enter to run": "⌘ + Enter 运行",
  "could not save resource settings": "无法保存资源设置",
  "query timeout must be between 15 and 3600 seconds":
    "查询超时必须为 15–3600 秒",
  "query stopped to preserve free disk space":
    "磁盘空间不足，查询已停止以保留空闲空间",

  "{provider} / read-only": "{provider} / 只读",
  "Update to {version}": "升级至 {version}",
  "Review and install update": "查看并安装更新",
  "Software updates": "软件更新",
  "Check for updates": "检查更新",
  "Automatically check for updates": "自动检查更新",
  "Version {version}": "版本 {version}",
  "updates are unavailable in this build": "此版本暂不支持自动更新",
  "an update check is already in progress": "正在检查更新",
  "could not start the updater": "无法启动更新程序",
  "could not read update settings": "无法读取更新设置",
  General: "通用",
  Language: "语言",
  Settings: "设置",
  "Settings categories": "设置分类",
  "Cloud connections": "云连接",
  Appearance: "外观",
  Mode: "模式",
  Light: "浅色",
  Dark: "深色",
  Auto: "自动",
  "Open data": "打开数据",
  "Open files": "已打开文件",
  Workspaces: "工作区",
  Columns: "字段",
  File: "文件",
  "Single file": "单个文件",
  Welcome: "欢迎",
  Export: "导出",
  "Export the visible result page as JSON or CSV":
    "将当前结果页导出为 JSON 或 CSV",
  "Explore your data": "探索你的数据",
  "File metadata": "文件元数据",
  rows: "行",
  columns: "字段",
  "file size": "文件大小",
  "row groups": "行组",
  Views: "视图",
  "Explore Data": "探索数据",
  Schema: "结构",
  "Query editor": "查询编辑器",
  "Read-only / table: data": "只读 / 表：data",
  "Read-only / workspace": "只读 / 工作区",
  Reset: "重置",
  "Workspace tables": "工作区表",
  "Use data for the current file, or insert a workspace table below to JOIN or UNION files. Expand folders in the sidebar to see more tables.":
    "使用 data 查询当前文件，或插入下方工作区表，通过 JOIN 或 UNION 跨文件查询。展开侧栏文件夹可显示更多表。",
  'Insert a table name below, or type workspace."relative/path.parquet". JOIN and UNION files without opening them. Expand folders in the sidebar to see more tables.':
    '插入下方表名，或输入 workspace."relative/path.parquet"，无需打开文件即可进行 JOIN 或 UNION 查询。展开侧栏文件夹可显示更多表。',
  Use: "使用",
  "for the current file, or insert a workspace table below to JOIN or UNION files. Expand folders in the sidebar to see more tables. Only this workspace is available.":
    "查询当前文件，或插入下方工作区表进行 JOIN 或 UNION 查询。展开侧栏文件夹可显示更多表，仅限当前工作区。",
  "SQL query": "SQL 查询",
  "Run query": "运行查询",
  Column: "字段",
  "Filter column": "筛选字段",
  "Choose a column": "选择字段",
  Contains: "包含",
  "Filter value": "筛选值",
  "Text to match": "要匹配的文本",
  "Apply filter": "应用筛选",
  Clear: "清除",
  Rows: "行数",
  "Rows per page": "每页行数",
  "Query results": "查询结果",
  "No matching rows.": "没有匹配的数据。",
  "Try another filter or query.": "请尝试其他筛选条件或查询。",
  Ready: "就绪",
  "Previous page": "上一页",
  "Next page": "下一页",
  "Page 1": "第 1 页",
  "Page {page}": "第 {page} 页",
  "Logical type": "逻辑类型",
  "Types are read directly from the Parquet file. Values stay exact across the desktop bridge.":
    "类型直接读取自 Parquet 文件，数据传递保留精确数值。",
  "Reading your file…": "正在读取文件…",
  Cancel: "取消",
  "Export data": "导出数据",
  "Export the current preview page. Choose a format.":
    "导出当前预览页。请选择格式。",
  "Close export chooser": "关闭导出选项",
  "Preserve column types, exact values and NULL.":
    "保留字段类型、精确数值和 NULL。",
  "Formula-like text gets a leading apostrophe. NULL and empty text export as empty fields. Use JSON for original values.":
    "公式样式文本会添加前置单引号。NULL 和空文本均导出为空字段。保留原始值请使用 JSON。",
  "Choose where your data lives.": "选择数据所在的位置。",
  "Close data source chooser": "关闭数据来源选择",
  "Data location": "数据位置",
  "This Mac": "本机",
  "Cloud storage": "云存储",
  "Open file": "打开文件",
  "Browse a Parquet file": "浏览 Parquet 文件",
  "Open folder": "打开文件夹",
  "Query files together as a workspace": "将文件夹作为工作区进行跨文件查询",
  "Connect a bucket or folder prefix": "连接存储桶或文件夹前缀",
  "Connect an AWS bucket": "连接 AWS 存储桶",
  "Manage connections": "管理连接",
  "Read-only connections. Credentials stay in macOS Keychain.":
    "只读连接。凭据保存在 macOS 钥匙串中。",
  "Close settings": "关闭设置",
  "Manage your saved data connections.": "管理已保存的数据连接。",
  "Available across workspaces": "可在不同工作区使用",
  "Add connection": "添加连接",
  "Cancel operation": "取消操作",
  "Connect Cloudflare R2": "连接 Cloudflare R2",
  "Browse and query Parquet files in a read-only workspace.":
    "在只读工作区中浏览和查询 Parquet 文件。",
  "Close cloud connection": "关闭云连接设置",
  Provider: "服务商",
  "Workspace name": "工作区名称",
  optional: "可选",
  "Research data": "研究数据",
  "S3 endpoint": "S3 端点",
  "AWS Region": "AWS 区域",
  Bucket: "存储桶",
  "Folder prefix": "文件夹前缀",
  "Access Key ID": "访问密钥 ID",
  "Secret Access Key": "私密访问密钥",
  "Session Token": "会话令牌",
  "for temporary credentials": "临时凭据需要填写",
  Back: "返回",
  "Test & connect": "测试并连接",
  "Test & save": "测试并保存",
  "Testing…": "正在测试…",
  "Use R2 Object Read only credentials scoped to this bucket. Keys are stored in macOS Keychain. Files are read from R2 as needed; queries run on this Mac.":
    "使用仅限此存储桶的 R2 Object Read only 凭据。密钥保存在 macOS 钥匙串中。按需读取 R2 文件，查询在本机运行。",
  "Use R2 Object Read only credentials scoped to this bucket. Credentials stay in macOS Keychain. Queries run on this Mac.":
    "使用仅限此存储桶的 R2 Object Read only 凭据。凭据保存在 macOS 钥匙串中，查询在本机运行。",
  "Use credentials with s3:ListBucket and s3:GetObject permissions. Temporary credentials also require a Session Token; replace them when they expire. Credentials stay in macOS Keychain. Queries run on this Mac.":
    "使用具有 s3:ListBucket 和 s3:GetObject 权限的凭据。临时凭据还需要会话令牌，过期后需更换。凭据保存在 macOS 钥匙串中，查询在本机运行。",
  "Leave all credential fields blank to keep saved credentials. Provide both keys and any Session Token to replace them. Close the workspace before changing its location.":
    "留空所有凭据字段可保留已保存的凭据；如需更换，请填写两个密钥及适用的会话令牌。更改位置前请先关闭工作区。",
  "Leave all credential fields blank to keep saved credentials. Provide both keys and any Session Token to replace them. Changing location resets saved queries.":
    "留空所有凭据字段可保留已保存的凭据；如需更换，请填写两个密钥及适用的会话令牌。更改位置会重置已保存的查询。",
  "Other files": "其他文件",
  "Switching file…": "正在切换文件…",
  "Closing file…": "正在关闭文件…",
  "Insert {ref} at cursor": "在光标处插入 {ref}",
  "Close {name}": "关闭 {name}",
  "Kept for this session": "保留于本次会话",
  "Saving…": "正在保存…",
  "Saved locally": "已保存到本地",
  "Not saved": "未保存",
  "Unsaved changes": "尚未保存",
  "Could not save query: {error}": "无法保存查询：{error}",
  "Reading folder…": "正在读取文件夹…",
  "Opening file…": "正在打开文件…",
  "Load more entries": "加载更多",
  "No visible folders or Parquet files": "没有可显示的文件夹或 Parquet 文件",
  "No directory listing returned": "未返回文件夹列表",
  "No file returned": "未返回文件",
  "No workspace returned": "未返回工作区",
  "No cloud workspace returned": "未返回云端工作区",
  "No query result returned": "未返回查询结果",
  "Saved query could not run; showing the file preview. Draft preserved. {error}":
    "已保存的查询无法运行，正在显示文件预览。草稿已保留。{error}",
  "Saved workspace query could not run. Draft preserved. {error}":
    "已保存的工作区查询无法运行，草稿已保留。{error}",
  "File closed. Choose another file to continue. {error}":
    "文件已关闭。请选择其他文件继续。{error}",
  "Last file is unavailable. Choose another file. {error}":
    "上次打开的文件不可用，请选择其他文件。{error}",
  "Write a query to preview workspace data.": "输入查询以预览工作区数据。",
  "Ready to query": "可以开始查询",
  "Workspace query": "工作区查询",
  "Query this workspace": "查询此工作区",
  "Rename workspace": "重命名工作区",
  "Close workspace": "关闭工作区",
  "Collapse workspace": "收起工作区",
  "Expand workspace": "展开工作区",
  Save: "保存",
  Refresh: "刷新",
  "Workspace files": "工作区文件",
  "Opening workspace query…": "正在打开工作区查询…",
  "Refreshing folder…": "正在刷新文件夹…",
  "Renaming workspace…": "正在重命名工作区…",
  "Closing workspace…": "正在关闭工作区…",
  "Opening workspace…": "正在打开工作区…",
  "Cloud storage is unavailable. Refresh to retry, or reconnect with updated credentials.":
    "云存储不可用。请刷新重试，或更新凭据后重新连接。",
  "{provider} / Workspace open": "{provider} / 工作区已打开",
  "{provider} / Saved": "{provider} / 已保存",
  "Open connection: {name}": "打开连接：{name}",
  "Edit connection: {name}": "编辑连接：{name}",
  "Delete connection: {name}": "删除连接：{name}",
  "Loading connections…": "正在加载连接…",
  "No saved connections yet. Add a cloud connection to get started.":
    "尚无已保存的连接。添加云连接即可开始。",
  Open: "已打开",
  Saved: "已保存",
  "Workspace open": "工作区已打开",
  "Open connection": "打开连接",
  "Edit connection": "编辑连接",
  "Delete connection": "删除连接",
  "Confirm deletion of {name}": "确认删除 {name}",
  "Delete “{name}”?": "删除“{name}”？",
  "This removes the saved connection and credentials and closes its open files. Cloud files stay unchanged.":
    "这将移除已保存的连接及凭据，并关闭该连接中已打开的文件。云端文件不会被删除。",
  "Deleting connection…": "正在删除连接…",
  "Opening connection…": "正在打开连接…",
  "Edit {provider}": "编辑 {provider}",
  "Connect {provider}": "连接 {provider}",
  "Testing cloud connection…": "正在测试云连接…",
  "Sorting…": "正在排序…",
  "Sort by {name}": "按 {name} 排序",
  empty: "空文本",
  "{rows} rows / {size}": "{rows} 行 / {size}",
  "{start}–{end} / more rows available / {ms} ms":
    "{start}–{end} / 还有更多行 / {ms} 毫秒",
  "{start}–{end} / end of results / {ms} ms":
    "{start}–{end} / 已到末尾 / {ms} 毫秒",
  "0 rows / {ms} ms": "0 行 / {ms} 毫秒",
  "SQL result": "SQL 结果",
  "Opening Parquet…": "正在打开 Parquet…",
  "Running query…": "正在运行查询…",
  "Filtering…": "正在筛选…",
  "Clearing filter…": "正在清除筛选…",
  "Reading page…": "正在读取数据页…",
  "Choose where to export…": "请选择导出位置…",
  "Exported visible page to {path}": "当前预览页已导出到 {path}",
  "Drop to open Parquet": "松开以打开 Parquet",
  "Release the file anywhere in this window.": "将文件放到窗口内任意位置。",
  "Restoring workspaces…": "正在恢复工作区…",
  "Inline suggestions: Tab to accept, Escape to dismiss.":
    "行内补全：按 Tab 接受，按 Esc 忽略。",
  "could not save language": "无法保存语言设置",
  "unsupported interface language": "不支持此界面语言",
  "could not save appearance": "无法保存外观设置",
};
let language: Language = "en";
/** Return the active interface language. */
export const getLanguage = () => language;
/** Translate an app-owned key and interpolate named placeholders. */
export function t(key: string, params: Params = {}): string {
  const message = language === "zh-CN" ? (chinese[key] ?? key) : key;
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
type Binding = {
  key: string;
  params: Params;
  prefix: string;
  suffix: string;
  last: string;
};
const bindings = new Map<Node, Map<string, Binding>>();
function write(node: Node, attribute: string, value: string) {
  if (attribute) (node as Element).setAttribute(attribute, value);
  else node.textContent = value;
}
function read(node: Node, attribute: string) {
  return attribute
    ? (node as Element).getAttribute(attribute)
    : node.textContent;
}
function bind(
  node: Node,
  attribute: string,
  key: string,
  params: Params = {},
  prefix = "",
  suffix = "",
) {
  let entries = bindings.get(node);
  if (!entries) {
    entries = new Map();
    bindings.set(node, entries);
  }
  const last = prefix + t(key, params) + suffix;
  entries.set(attribute, { key, params, prefix, suffix, last });
  write(node, attribute, last);
}
/** Bind UI text so it updates when the language changes. */
export function setText(node: Node, key: string, params: Params = {}) {
  bind(node, "", key, params);
}
/** Bind a translated UI attribute such as an accessible label. */
export function setAttribute(
  node: Element,
  attribute: string,
  key: string,
  params: Params = {},
) {
  bind(node, attribute, key, params);
}
/** Only use on app-owned static markup, before inserting file names, cells or other user data. */
export function localizeStatic(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("svg, textarea, script, style, code"))
      continue;
    const text = node.textContent!;
    const key = text.trim();
    if (Object.hasOwn(chinese, key))
      bind(
        node,
        "",
        key,
        {},
        text.slice(0, text.indexOf(key)),
        text.slice(text.indexOf(key) + key.length),
      );
  }
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attr of ["title", "aria-label", "placeholder"]) {
      const key = element.getAttribute(attr);
      if (key && Object.hasOwn(chinese, key)) bind(element, attr, key);
    }
  }
}
/** Update connected UI bindings without translating raw user data. */
export function setLanguage(next: Language) {
  language = next;
  document.documentElement.lang = next;
  for (const [node, entries] of bindings) {
    if (!node.isConnected) {
      bindings.delete(node);
      continue;
    }
    for (const [attribute, b] of entries) {
      // A raw data assignment supersedes a previously localized UI placeholder.
      if (read(node, attribute) !== b.last) {
        entries.delete(attribute);
        continue;
      }
      b.last = b.prefix + t(b.key, b.params) + b.suffix;
      write(node, attribute, b.last);
    }
  }
}

/** Write raw file or query data and remove any previous translation binding. */
export function rawText(node: Node, value: string) {
  bindings.get(node)?.delete("");
  node.textContent = value;
}
/** Release bindings for nodes removed from the document. */
export function pruneTranslations() {
  for (const node of bindings.keys())
    if (!node.isConnected) bindings.delete(node);
}
