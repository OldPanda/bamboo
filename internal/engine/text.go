package engine

import (
	"bamboo/internal/datafile"
	"context"
	"fmt"
)

// SetTextOptionsResolver installs the local per-file preferences reader before
// operations begin. It grants no paths; workspace resolution remains separate.
func (e *Engine) SetTextOptionsResolver(resolve func(string) (datafile.TextOptions, error)) {
	e.textOptions = resolve
}

func (e *Engine) options(path string) (datafile.TextOptions, error) {
	if e.textOptions != nil {
		return e.textOptions(path)
	}
	return datafile.DefaultTextOptions(path), nil
}

func (e *Engine) createLocalView(ctx context.Context, db *database, name, path string) error {
	if !datafile.IsText(path) {
		return createView(ctx, db, name, path)
	}
	options, err := e.options(path)
	if err != nil {
		return err
	}
	if err = options.Validate(); err != nil {
		return err
	}
	// Explicitly forbid skipped/rejected rows, padding, inferred comments and
	// non-UTF-8 decoding. Only the already allowlisted file is visible to DuckDB.
	args := fmt.Sprintf(", header=%t, all_varchar=%t, auto_detect=true, sample_size=20480, skip=0, comment='', quote='\"', escape='\"', encoding='utf-8', compression='none', hive_partitioning=false, ignore_errors=false, store_rejects=false, null_padding=false, strict_mode=true, allow_quoted_nulls=false, max_line_size=4194304, buffer_size=16777216", options.Header, !options.InferTypes)
	if options.Delimiter != "" {
		args += ", delim=" + literal(options.Delimiter)
	}
	// Decimal input stays text unless the user explicitly casts it. Do not infer
	// DOUBLE and silently round long decimal values. Numeric inference is integral.
	if options.InferTypes {
		args += ", auto_type_candidates=['BOOLEAN','BIGINT','HUGEINT','DATE','VARCHAR']"
	}
	_, err = db.ExecContext(ctx, "CREATE VIEW "+name+" AS SELECT * FROM read_csv("+literal(path)+args+")")
	return err
}
