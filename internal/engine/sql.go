package engine

import (
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
	fail := errors.New("enter one SELECT or WITH query; dollar-quoted SQL and multiple statements are not supported")
	word := strings.Fields(s)[0]
	if !strings.EqualFold(word, "SELECT") && !strings.EqualFold(word, "WITH") {
		return "", fail
	}
	depth := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
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
			for i < len(s) && s[i] != '\n' {
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
