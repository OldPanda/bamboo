package engine

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

// selectSQL is a conservative lexical gate, not a SQL parser. DuckDB still
// parses the query. It prevents unbalanced wrappers and multi-statement input
// BEFORE database/sql can prepare (and execute preceding statements).
func selectSQL(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "SELECT * FROM data", nil
	}
	fail := errors.New("enter one SELECT or WITH query; escape strings, dollar-quoted SQL and multiple statements are not supported")
	if strings.ContainsRune(s, 0) {
		return "", fail
	}
	word := strings.Fields(s)[0]
	if !strings.EqualFold(word, "SELECT") && !strings.EqualFold(word, "WITH") {
		return "", fail
	}
	depth := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		// The workspace scanner only understands standard doubled-quote strings.
		// Reject DuckDB escape strings before either scanner can disagree with it.
		if (c == 'E' || c == 'e') && i+1 < len(s) && s[i+1] == '\'' {
			return "", fail
		}
		if c == '\'' || c == '"' {
			quote := c
			closed := false
			for i++; i < len(s); i++ {
				if s[i] == quote {
					if i+1 < len(s) && s[i+1] == quote {
						i++
						continue
					}
					closed = true
					break
				}
			}
			if !closed {
				return "", fail
			}
			continue
		}
		if c == '-' && i+1 < len(s) && s[i+1] == '-' {
			for i < len(s) && s[i] != '\n' && s[i] != '\r' {
				i++
			}
			continue
		}
		if c == '/' && i+1 < len(s) && s[i+1] == '*' {
			level := 1
			i += 2
			for i < len(s) && level > 0 {
				if i+1 < len(s) && s[i:i+2] == "/*" {
					level++
					i += 2
				} else if i+1 < len(s) && s[i:i+2] == "*/" {
					level--
					i += 2
				} else {
					i++
				}
			}
			if level > 0 {
				return "", fail
			}
			i--
			continue
		}
		switch c {
		case '$':
			return "", fail
		case '(':
			depth++
		case ')':
			depth--
			if depth < 0 {
				return "", fail
			}
		case ';':
			if depth != 0 || strings.TrimSpace(s[i+1:]) != "" {
				return "", fail
			}
			s = strings.TrimSpace(s[:i])
			i = len(s)
		}
	}
	if depth != 0 {
		return "", fail
	}
	return s, nil
}

// validateSelect uses DuckDB's parser without preparing or executing user SQL.
// The parameter is data to json_serialize_sql, which only accepts SELECT syntax.
// A parser error or an unexpected response fails closed before DESCRIBE/Query.
func validateSelect(ctx context.Context, db *database, query string) error {
	var raw string
	if err := db.QueryRowContext(ctx, "SELECT json_serialize_sql(?)::VARCHAR", query).Scan(&raw); err != nil {
		return err
	}
	var parsed struct {
		Error      *bool             `json:"error"`
		Statements []json.RawMessage `json:"statements"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return err
	}
	if parsed.Error == nil || *parsed.Error || len(parsed.Statements) != 1 {
		return errors.New("enter exactly one valid SELECT or WITH query")
	}
	return nil
}
