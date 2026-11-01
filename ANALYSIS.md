# On-demand column statistics and pivots

Run a query, then choose **Analyze**. Both operations use the **complete last
successful query**, with its column projection, SQL `LIMIT` and current contains
filter. Preview pagination and presentation sorting do not restrict analysis.
Editing SQL or a failed query does not change the captured query. This is exact
analysis, never sampling; the source is read again and may have changed since
the preview. It is not a transactional copy of source bytes.

**Column statistics** reports total rows, NULL rows, distinct non-NULL values,
minimum, maximum and the 20 most frequent values, including NULL. Ordering and
equality follow the column's DuckDB type and collation. Counts and values cross
IPC as exact strings or null. Equal-frequency groups retain database value order.
More than 10,000 distinct non-NULL values produces an error instead of a partial
profile. Filter the query or choose a lower-cardinality column to continue.

**Pivot** groups by one selected column and computes COUNT, SUM, AVG, MIN or MAX.
COUNT counts rows including those with a NULL metric; the other aggregates use
normal DuckDB NULL and numeric-type rules. In particular, AVG can return DOUBLE
and therefore follows floating-point SQL semantics; no additional JavaScript
number conversion is performed. Cast text input explicitly before numeric
aggregation, for example `amount::DECIMAL(38,9)` in the source query.

Pivots are complete results limited to 1,000 groups and 4 MiB of value text,
plus bounded metadata/serialization overhead. Exceeding a limit rejects the
result, never silently truncates it. **Export pivot** writes this captured
complete snapshot as JSON, JSONL, CSV or TSV using the existing exact-value and
spreadsheet-protection contracts. It does not rerun the query. The normal preview
and its export snapshot remain unchanged. A new successful query or source
selection invalidates pivot export eligibility.

Analysis uses the same validated, read-only engine path and local/cloud workspace
resolution. Identifiers are quoted, aggregate operations are allowlisted and
filter values remain bound parameters. CSV/TSV options also apply. The native
aggregate operators retain memory, temporary disk and timeout budgets, and may
need spill for large groups; these are not a process sandbox. Cancel or Escape
while analyzing interrupts the operation and keeps the workspace available.

## 中文说明

成功运行查询后点击“分析”。列统计与透视均基于最后一次成功查询的完整结果，保留
列投影、SQL LIMIT 和包含筛选，不受预览页大小或页码限制，也不进行采样。分析会
重新读取数据源，外部修改可能影响结果。

列统计提供总行数、NULL 行数、不同非 NULL 值、最小值、最大值及频次最高的 20 个
值。超过 10,000 个不同值会报错。透视可选一个分组列和 COUNT / SUM / AVG / MIN /
MAX 指标，最多 1,000 个分组、4 MiB 值文本；超限时拒绝返回不完整结果。COUNT 统计
所有行，其他聚合遵循 DuckDB 类型与 NULL 语义；AVG 可能返回浮点 DOUBLE。文本
数字可先在源查询中显式 CAST 为精确 DECIMAL。

“导出透视结果”保存完整快照，支持 JSON、JSONL、CSV 和 TSV，不替换原查询预览或
其导出目标。新查询成功或切换数据源后，旧透视导出失效。内存、临时磁盘、超时与
路径隔离继续生效，可点击取消或按 Escape 中止分析。

Real engine/Workbench tests exercise generated Parquet and CSV/TSV, mixed-format
queries, synthetic cloud scopes, bound filters, exact aggregates, NULLs,
high-cardinality/byte limits, cancellation, source hashes and independent exports.
The native desktop smoke checks full-query counts and a pivot against fixed
oracles through the shipped UI/IPC path on disposable CI runners. Headless layout
and focus checks remain separate evidence from native integration.
