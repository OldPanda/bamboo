package engine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func openDatabase(ctx context.Context, paths []string) (*sql.DB, error) {
	db, err := sql.Open("duckdb", "?threads=2&memory_limit=256MB&max_temp_directory_size=0B&autoload_known_extensions=false&autoinstall_known_extensions=false")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	quoted := make([]string, len(paths))
	for i, path := range paths {
		quoted[i] = literal(path)
	}
	for _, q := range []string{"SET TimeZone = 'UTC'", "SET allowed_paths = [" + strings.Join(quoted, ",") + "]", "SET enable_external_access = false", "SET lock_configuration = true"} {
		if _, err = db.ExecContext(ctx, q); err != nil {
			db.Close()
			return nil, err
		}
	}
	return db, nil
}
func createView(ctx context.Context, db *sql.DB, name, path string) error {
	_, err := db.ExecContext(ctx, "CREATE VIEW "+name+" AS SELECT * FROM read_parquet("+literal(path)+", hive_partitioning=false)")
	return err
}

// workspaceReferences only discovers identifiers. selectSQL validates the lexical
// envelope first; DuckDB parses SQL. Comments and string literals cannot grant access.
func workspaceReferences(query string) ([]string, error) {
	q, err := selectSQL(query)
	if err != nil {
		return nil, err
	}
	type token struct {
		text       string
		identifier bool
	}
	tokens := []token{}
	for i := 0; i < len(q); {
		c := q[i]
		if c == ' ' || c == '\n' || c == '\r' || c == '\t' {
			i++
			continue
		}
		if i+1 < len(q) && q[i:i+2] == "--" {
			for i < len(q) && q[i] != '\n' {
				i++
			}
			continue
		}
		if i+1 < len(q) && q[i:i+2] == "/*" {
			i += 2
			depth := 1
			for depth > 0 && i < len(q) {
				if i+1 < len(q) && q[i:i+2] == "/*" {
					depth++
					i += 2
				} else if i+1 < len(q) && q[i:i+2] == "*/" {
					depth--
					i += 2
				} else {
					i++
				}
			}
			continue
		}
		if c == '\'' || c == '"' {
			i++
			var b strings.Builder
			for i < len(q) {
				if q[i] == c {
					i++
					if i < len(q) && q[i] == c {
						b.WriteByte(c)
						i++
						continue
					}
					break
				}
				b.WriteByte(q[i])
				i++
			}
			tokens = append(tokens, token{b.String(), c == '"'})
			continue
		}
		if c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= 128 {
			start := i
			i++
			for i < len(q) {
				c = q[i]
				if !(c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c >= 128) {
					break
				}
				i++
			}
			tokens = append(tokens, token{q[start:i], true})
			continue
		}
		tokens = append(tokens, token{string(c), false})
		i++
	}
	refs := []string{}
	seen := map[string]bool{}
	for i := 0; i+2 < len(tokens); i++ {
		if tokens[i].identifier && strings.EqualFold(tokens[i].text, "workspace") && tokens[i+1].text == "." && !tokens[i+1].identifier && tokens[i+2].identifier {
			name := tokens[i+2].text
			if !seen[name] {
				refs = append(refs, name)
				seen[name] = true
			}
		}
	}
	if len(refs) > 32 {
		return nil, errors.New("a query can reference up to 32 workspace files")
	}
	return refs, nil
}

func (e *Engine) queryDatabase(ctx context.Context, query string) (*sql.DB, func(), error) {
	refs, err := workspaceReferences(query)
	if err != nil {
		return nil, nil, err
	}
	if len(refs) == 0 && e.db != nil {
		return e.db, func() {}, nil
	}
	if e.resolve == nil {
		return nil, nil, errors.New("open a file in a workspace to query workspace tables")
	}
	paths := []string{}
	if e.file != nil {
		paths = append(paths, e.file.Path)
	}
	start := len(paths)
	for _, ref := range refs {
		if !strings.EqualFold(filepath.Ext(ref), ".parquet") || strings.ContainsAny(ref, "*?[]\x00") {
			return nil, nil, errors.New("workspace tables must name a .parquet file without wildcards")
		}
		path, err := e.resolve(ref)
		if err != nil {
			return nil, nil, fmt.Errorf("workspace table %q: %w", ref, err)
		}
		if !filepath.IsAbs(path) || !strings.EqualFold(filepath.Ext(path), ".parquet") || strings.ContainsAny(path, "*?[]\x00") {
			return nil, nil, errors.New("workspace table must resolve to an absolute Parquet path without wildcards")
		}
		st, err := os.Stat(path)
		if err != nil {
			return nil, nil, err
		}
		if !st.Mode().IsRegular() {
			return nil, nil, errors.New("workspace table must be a regular Parquet file")
		}
		paths = append(paths, path)
	}
	db, err := openDatabase(ctx, paths)
	if err != nil {
		return nil, nil, err
	}
	closeDB := func() { db.Close() }
	if e.file != nil {
		err = createView(ctx, db, "data", e.file.Path)
	}
	if err == nil {
		_, err = db.ExecContext(ctx, "CREATE SCHEMA workspace")
	}
	if err == nil {
		for i, ref := range refs {
			if err = createView(ctx, db, "workspace."+ident(ref), paths[i+start]); err != nil {
				break
			}
		}
	}
	if err != nil {
		closeDB()
		return nil, nil, err
	}
	return db, closeDB, nil
}
