package engine

import (
	"context"
	"crypto/rand"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"

	"github.com/duckdb/duckdb-go/v2"
)

// The pinned driver's cursor materializes its native result. A volatile native
// scalar sink consumes rows during execution and returns only a scalar aggregate
// through that cursor. Thus the user's result is never materialized. Its private
// single-threaded database preserves callback order and is closed after export.
func consumeResult(ctx context.Context, db *database, query string, args []any, columns []Column, sink RowSink) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	textType, _ := duckdb.NewTypeInfo(duckdb.TYPE_VARCHAR)
	countType, _ := duckdb.NewTypeInfo(duckdb.TYPE_BIGINT)
	consumer := &rowConsumer{ctx: ctx, columns: columns, sink: sink, textType: textType, countType: countType}
	// An unguessable per-export function cannot be referenced by captured SQL.
	name := "bamboo_export_" + rand.Text()
	if err = duckdb.RegisterScalarUDF(conn, name, consumer); err != nil {
		return err
	}
	names := make([]string, len(columns))
	for i := range names {
		names[i] = fmt.Sprintf("c%d", i)
	}
	fields := strings.Join(names, ",")
	statement := "SELECT sum(" + ident(name) + "(" + fields + "))::VARCHAR FROM (" + query + "\n) AS bamboo_stream(" + fields + ")"
	var count sql.NullString
	err = conn.QueryRowContext(ctx, statement, args...).Scan(&count)
	if consumer.failure != nil {
		return consumer.failure
	}
	return err
}

type rowConsumer struct {
	ctx                 context.Context
	columns             []Column
	sink                RowSink
	textType, countType duckdb.TypeInfo
	failure             error
}

func (c *rowConsumer) Config() duckdb.ScalarFuncConfig {
	return duckdb.ScalarFuncConfig{VariadicTypeInfo: c.textType, ResultTypeInfo: c.countType, Volatile: true, SpecialNullHandling: true}
}

func (c *rowConsumer) Executor() duckdb.ScalarFuncExecutor {
	return duckdb.ScalarFuncExecutor{RowExecutor: func(values []driver.Value) (any, error) {
		if c.failure != nil {
			return nil, c.failure
		}
		c.failure = c.consume(values)
		if c.failure != nil {
			return nil, c.failure
		}
		return int64(1), nil
	}}
}

func (c *rowConsumer) consume(values []driver.Value) error {
	if err := c.ctx.Err(); err != nil {
		return err
	}
	if len(values) != len(c.columns) {
		return errors.New("result columns do not match row values")
	}
	row := make([]*string, len(values))
	size := 0
	for i, value := range values {
		if value == nil {
			continue
		}
		text, ok := value.(string)
		if !ok {
			return errors.New("export expected a textual value")
		}
		if len(text) > MaxCell {
			return errors.New("cell exceeds 64 KiB; select a substring or fewer columns in SQL")
		}
		size += len(text)
		if size > MaxResult {
			return errors.New("row exceeds 4 MiB; select fewer columns in SQL")
		}
		row[i] = &text
	}
	return c.sink(c.columns, row)
}
