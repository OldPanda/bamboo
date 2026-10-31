# Exact Parquet values

## Legacy INT96 timestamps

INT96 stores a Julian day and nanoseconds since midnight. Bamboo reads these
columns as `STRUCT(date DATE, "time" TIME_NS)` using DuckDB's `int96_as='struct'`
option. This preserves all nine fractional digits and dates from 0001 through
9999, including NULL. The default `TIMESTAMP` reader truncates to microseconds;
`TIMESTAMP_NS` alone converts dates outside its narrower range to infinity.

For example, `1970-01-01 00:00:00.123456789` is displayed and exported as
`{'date': 1970-01-01, 'time': '00:00:00.123456789'}`. SQL can select
`stamp.date` and `stamp.time` independently. Existing queries applying timestamp
functions directly to an INT96 column must use those fields instead. Modern
INT64 timestamp columns keep their existing timestamp types.

The shared reader option applies to local files, folder workspaces, S3 and R2.
[INT96 regressions](../internal/engine/int96_test.go) use an independent PLAIN
Parquet writer to check nanoseconds, pre-epoch values, range endpoints, NULL,
pagination, child filtering/sorting, failed-query recovery, synthetic cloud
range-cache reuse and unchanged source hashes. No native DuckDB patch is added.

## Legacy decimal annotations

Bamboo accepts legacy Parquet DECIMAL annotations that specify precision and
omit scale. The [Parquet specification](https://github.com/apache/parquet-format/blob/master/LogicalTypes.md#decimal)
defines the omitted scale as zero. This includes files produced by SAP exports
such as the public [TCURR reproduction](https://github.com/mukunku/ParquetViewer/issues/128).

The bundled DuckDB 2.0.0 reader previously required both fields. Bamboo applies
[one native reader patch](../scripts/duckdb/decimal.patch): default only an
omitted scale, retain precision/scale validation, check physical-type capacity,
and reject precision above 38 instead of DuckDB's floating-point fallback.
Such wider decimals remain unsupported; Bamboo does not silently approximate
their values. Decimal values within the supported range remain exact strings
through the engine, bridge and export.

This is the same reader for independent local files, folder-workspace queries,
Amazon S3 and Cloudflare R2. The patch does not modify files, copy complete
objects, change gateway/cache identities, add runtime downloads or introduce
a Python dependency into the application. Existing ranged reads, cancellation,
query budgets and source-access restrictions remain in their existing paths.

## Reproducible native build

[prepare_parquet.py](../scripts/prepare_parquet.py) is called by the existing
release-link helper for build, test and vet on every platform. It uses upstream
CMake's `parquet_extension` target with the existing prebuilt DuckDB core:

- DuckDB source: `d54cbbe3df17e8e5ce68312f483b4155836112aa` (`v2.0.0`).
- Source archive SHA-256: `93e3d1f9c84b6ec3493237d21565c01c2c19b9862e54e5552d3d7999ccc3bbb4`.
- The module's provenance must match that source and version.
- CMake's three supported wheels are SHA-256-pinned in `requirements-build.txt`.
  Pip requires hashes and binary wheels. The helper selects that Python-installed
  CMake version rather than an ambient executable from `PATH`.
- Extraction is bounded and rejects links outside the excluded upstream data
  corpus; the single patch hunk must match exactly.
- Builds use two compiler processes. Cache identity includes source, patch,
  build script, target and compiler/tool versions. Cached output bytes are
  hashed before reuse. Compiler prefix maps remove local source/build paths.
- Other native components, including the signed, hash-pinned httpfs extension,
  retain their existing distribution. No module-cache archive is patched.

An upgrade of DuckDB requires explicit review of this patch and source pin.
Remove the patch when an upstream version implements the required behavior,
retaining the compatibility and precision regressions.

## Regression evidence

[decimal_test.go](../internal/engine/decimal_test.go) creates independent,
uncompressed Parquet fixtures using the format's compact metadata encoding.
It checks omitted and explicit scale, NULL, negative values, INT32, INT64,
fixed and variable byte arrays, exact 38-digit values, invalid metadata and
source hashes. Workspace and synthetic S3/R2 tests use the real engine and
scoped ranged gateway and check transferred bytes on repeated previews.

These tests are native CI checks; synthetic provider tests are not evidence of
live-provider access. The public SAP attachment is an additional acceptance
input, not a repository fixture or prerequisite for a fresh checkout.
