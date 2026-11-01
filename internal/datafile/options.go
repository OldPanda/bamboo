// Package datafile defines supported local input formats and delimited-text options.
package datafile

import (
	"errors"
	"path/filepath"
	"strings"
)

// TextOptions controls UTF-8 CSV/TSV interpretation without modifying the source.
// Empty Delimiter means detect; Header explicitly determines the first record.
// InferTypes is opt-in because conversion may normalize the original spelling.
type TextOptions struct {
	Delimiter  string `json:"delimiter"`
	Header     bool   `json:"header"`
	InferTypes bool   `json:"inferTypes"`
}

// DefaultTextOptions preserves text values and treats the first record as headers.
// TSV fixes its tab delimiter; CSV detects comma, tab, semicolon or pipe.
func DefaultTextOptions(path string) TextOptions {
	delimiter := ""
	if strings.EqualFold(filepath.Ext(path), ".tsv") {
		delimiter = "\t"
	}
	return TextOptions{Delimiter: delimiter, Header: true}
}

// Validate rejects unsupported delimiters before any SQL is constructed.
func (o TextOptions) Validate() error {
	switch o.Delimiter {
	case "", ",", "\t", ";", "|":
		return nil
	}
	return errors.New("choose automatic, comma, tab, semicolon or pipe delimiter")
}

// IsText identifies the explicitly supported delimited-file extensions.
func IsText(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".csv" || ext == ".tsv"
}

// Supported reports whether a local file can be opened by the workbench.
func Supported(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".parquet") || IsText(path)
}
