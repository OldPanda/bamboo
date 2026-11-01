# Local CSV and TSV files

Open or drop `.csv` / `.tsv` files, or select them in local folder workspaces.
Preview, SQL, filtering, sorting and page/complete-result exports use the same
flow as Parquet. Local workspace queries can JOIN or UNION formats through
references such as `workspace."customers.csv"`. S3/R2 workspaces remain Parquet-only.

The reading-options strip above the editor shows the current interpretation.
Choose **Reading options** to change it and reopen:

- CSV detects its delimiter; TSV defaults to tab. Explicit comma, tab, semicolon
  and pipe are available. Detection uses a bounded sample.
- The first record is a header by default. Disable this to retain it as data,
  with generated column names. DuckDB normalizes empty or duplicate names;
  records remain positional.
- All fields remain text by default, preserving leading zeros, large integers,
  decimals and timestamps. Optional inference considers integers, booleans and
  dates using up to 20,480 records, and may normalize their spelling. Decimals
  and timestamps remain text. Use explicit SQL types for arithmetic, for example
  `amount::DECIMAL(38,9)`. A later incompatible value stops the query.

Only UTF-8 is supported, including BOM. Double-quoted fields support escaped
quotes, delimiters and multiple lines. Unquoted empty fields are NULL; `""`
is empty text. Blank lines are ignored. Invalid UTF-8, malformed records and
oversized records stop the query; records are not padded or silently discarded.
An empty file may need a header before it has a usable schema.

Options persist privately by canonical file path, for up to 256 files, and apply
to standalone files and workspace references after restart. Unreadable settings
cause an error instead of reverting the interpretation. Applying options clears
export eligibility until a new query succeeds. Source bytes are never edited.

Rows and row groups show **—**: opening text does not run an extra full count.
Run `SELECT count(*) FROM data` when needed. Pages can rescan text; Parquet
benchmarks do not describe CSV/TSV performance. Memory, timeout and spill budgets
remain, with a 4 MiB record limit, 64 KiB result-cell limit and existing schema/page
limits. User SQL cannot call file readers or select arbitrary filesystem paths.

## 中文说明

本地 CSV / TSV 支持单文件、文件夹发现、跨文件 SQL、会话恢复和当前页或完整结果
导出。云工作区仍只支持 Parquet。默认首条记录为表头、所有值为文本；读取选项可
指定分隔符、关闭表头或启用整数、布尔值和日期推断。推断使用有界样本，可能规范化
值；小数和时间戳仍保留为文本，精确运算可显式使用 SQL CAST。

仅支持 UTF-8（含 BOM），支持引号内多行和双引号转义。无引号空字段为 NULL，
`""` 为空文本，空白行忽略。无效编码、畸形记录、类型不匹配及超长记录会报错。
读取选项按文件路径私有保存并在重启后恢复，不修改源文件。行数和行组显示“—”，
可主动执行 COUNT 查询；内存、磁盘、超时及结果大小限制继续生效。
