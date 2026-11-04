# Query history and saved queries

The right-edge **Query history** button opens a searchable dialog without
reserving editor space. **History** shows successful explicit runs; **Saved**
shows queries kept for reuse. Select a compact list item to preview its full SQL,
original file or workspace, and timestamp. Escape or Close returns focus to the
edge button. Tabs support arrow keys, Home and End.

Only an explicit, successful **Run query** adds history. Automatic previews,
restoration, pagination, sorting, filtering, analysis and exports do not add
entries. Repeating exact SQL on the same source refreshes that entry. Recording
failure leaves the successful query result available and shows an error.

**Save query** captures the current editor draft without executing it. Enter a
single-line name of up to 200 UTF-8 bytes. From a selected history entry, save its
SQL snapshot; from a saved entry, use **Rename query** to change only its name.
Older untitled saved queries display the SQL's first line. Search matches names,
SQL and source identities. Names, SQL and paths are rendered as text.

By default the dialog shows the current source. Turn off **Current source only**
to browse other sources. **Open in editor** is enabled only for the original
file or workspace. It switches to the query editor, closes the dialog and focuses
the SQL without running it. If the editor has changes since its last applied
query, choose **Replace draft** or **Keep draft** first. The source and current
draft are checked again before replacement. The dialog does not open files or
reconnect cloud storage, and saved SQL grants no source access.

**Delete query** removes the selected entry from both collections. **Clear
history** requires a second click, affects every source, and retains saved
queries. No data files, results or cloud objects are deleted.

Storage uses `query-library.json` in the existing application configuration
directory, with private file creation, sync and atomic replacement. It does not
use browser localStorage. SQL, names and source identities may contain sensitive
text; this local file is private, not encrypted. It contains no result rows or
connection credentials. Do not put credentials in SQL.

Unreadable or unsupported saved state is reported and preserved against writes.
At most 100 recent history entries and 100 saved queries are retained, with
32 KiB per SQL and an 8 MiB total encoded file limit. Old history is evicted
first; saved queries are never silently evicted. The existing `favorite` JSON
membership field remains unchanged for compatibility; `name` is optional.

## 中文

右侧的**查询记录**按钮按需打开弹窗，不占用编辑器空间。**历史**与**已保存**
使用独立页签；选择紧凑列表中的记录可预览完整 SQL、原数据源和时间。
Escape 或关闭按钮将焦点返回入口；页签支持方向键、Home 和 End。

仅主动点击**运行查询**且成功后才记录历史；预览、分页、排序、筛选、恢复、
分析和导出均不会新增历史。保存失败不影响已成功的查询结果。

**保存查询**捕获当前草稿而不执行，名称须为单行、最多 200 个 UTF-8 字节。
历史记录可保存，已保存查询可重命名。旧的未命名记录显示 SQL 首行。
搜索支持名称、SQL 和数据源；动态内容均按纯文本显示。

默认仅显示当前数据源，取消勾选后可浏览其他文件或工作区的查询。
仅原数据源可以**打开到编辑器**，该操作会关闭弹窗并聚焦 SQL，不会执行查询，
也不会打开文件或连接云存储。编辑器中有未执行的修改时，需要选择**替换草稿**
或**保留草稿**；替换前会再次检查数据源和当前草稿。

**删除查询**移除选中记录；**清空历史**需再次确认，作用于所有数据源，
已保存查询仍会保留。不会删除数据文件或云对象。

本地私有配置保存精确 SQL、名称、数据源和时间，不保存结果或连接凭据，
不使用 localStorage。最多保留 100 条历史及 100 条已保存查询，每条 SQL
最多 32 KiB，文件总量最多 8 MiB。无法读取的配置不会被覆盖；已保存查询
不会因历史轮换而丢失。
