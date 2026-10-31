package main

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/engine"
	"bamboo/internal/privatefs"
	"bamboo/internal/workspace"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/egoist/mygo"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"unicode"
)

// fileDialogs is the native boundary; tests use a dialog double without opening UI.
type fileDialogs interface {
	Open(mygo.OpenDialogOptions) ([]string, error)
	Save(mygo.SaveDialogOptions) (string, error)
}

// Workbench exposes local files, cloud workspaces, bounded queries and appearance.
type Workbench struct {
	updates      updateService
	engine       *engine.Engine
	remote       *cloudstorage.Store
	remoteCancel context.CancelFunc
	folders      *workspace.Store
	mu           sync.Mutex
	opMu         sync.Mutex
	last         *engine.Result
	initial      string
	configDir    string
	dialogs      fileDialogs
}

// InitialFile returns the optional Parquet path supplied at startup.
func (w *Workbench) InitialFile() string { return w.initial }

// Open shows the native file chooser and opens the selected Parquet file.
func (w *Workbench) Open(ctx context.Context) (*engine.File, error) {
	paths, err := w.dialogs.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: w.languageText("Open a Parquet file", "打开 Parquet 文件"), Filters: []mygo.FileFilter{{Name: "Parquet", Extensions: []string{"parquet"}}}})
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	return w.OpenPath(ctx, paths[0])
}

// OpenPath opens a local Parquet file and clears the previous export page on success.
func (w *Workbench) OpenPath(ctx context.Context, path string) (*engine.File, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	f, err := w.engine.Open(ctx, path)
	if err == nil {
		w.mu.Lock()
		w.last = nil
		w.mu.Unlock()
	}
	if err == nil && w.folders != nil {
		if saveErr := w.folders.Remember(f.Path, true); saveErr != nil {
			f.Warning = saveErr.Error()
		}
	}
	return f, err
}

// Query runs a preview and retains the successful page for export.
func (w *Workbench) Query(ctx context.Context, r engine.Request) (*engine.Result, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	result, err := w.engine.Query(ctx, r)
	if err == nil {
		w.mu.Lock()
		w.last = result
		w.mu.Unlock()
	}
	return result, err
}

// Cancel interrupts the active query or cloud operation.
func (w *Workbench) Cancel() {
	w.mu.Lock()
	if w.remoteCancel != nil {
		w.remoteCancel()
	}
	w.mu.Unlock()
	w.engine.Cancel()
}

// ExportPage saves the last successful page as typed JSON, keeping null distinct
// from empty text and preserving numeric precision. It never re-runs the query.
func (w *Workbench) ExportPage(ctx context.Context) (string, error) {
	return w.ExportPageAs(ctx, "json")
}

// ExportPageAs exports the last successful visible page as JSON or CSV.
// CSV prefixes formula-like text with an apostrophe; JSON preserves original values.
// NULL and empty text both become empty CSV fields.
func (w *Workbench) ExportPageAs(ctx context.Context, format string) (string, error) {
	if format != "json" && format != "csv" {
		return "", errors.New("choose JSON or CSV export format")
	}
	w.mu.Lock()
	r := w.last
	w.mu.Unlock()
	if r == nil {
		return "", errors.New("run a query before exporting")
	}
	path, err := w.dialogs.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: w.languageText("Export visible page as ", "导出当前页为 ") + strings.ToUpper(format), DefaultPath: "bamboo-page." + format, Filters: []mygo.FileFilter{{Name: strings.ToUpper(format), Extensions: []string{format}}}})
	if err != nil || path == "" {
		return "", err
	}
	if filepath.Ext(path) != "."+format {
		return "", fmt.Errorf("export filename must end in .%s", format)
	}
	return path, writeExportFormat(path, r, format)
}
func writeExportFormat(path string, r *engine.Result, format string) error {
	return writeExportFormatWith(path, r, format, func(path string) (io.WriteCloser, error) {
		return privatefs.Create(path)
	})
}

func writeExportFormatWith(path string, r *engine.Result, format string, create func(string) (io.WriteCloser, error)) error {
	if format != "json" && format != "csv" {
		return errors.New("choose JSON or CSV export format")
	}
	if r == nil {
		return errors.New("run a query before exporting")
	}
	if format == "csv" {
		for _, row := range r.Rows {
			if len(row) != len(r.Columns) {
				return errors.New("result columns do not match row values")
			}
		}
	}
	// O_EXCL also prevents symlink replacement and accidental source overwrites.
	f, err := create(path)
	if err != nil {
		return errors.New("choose a new filename; existing files are never overwritten")
	}
	if format == "json" {
		enc := json.NewEncoder(f)
		enc.SetIndent("", "  ")
		err = enc.Encode(r)
	} else {
		enc := csv.NewWriter(f)
		header := make([]string, len(r.Columns))
		for i, col := range r.Columns {
			header[i] = spreadsheetText(col.Name, "")
		}
		err = writeCSVRecord(enc, f, header)
		for _, row := range r.Rows {
			if err != nil {
				break
			}
			values := make([]string, len(row))
			for i, value := range row {
				if value != nil {
					values[i] = spreadsheetText(*value, r.Columns[i].Type)
				}
			}
			err = writeCSVRecord(enc, f, values)
		}
		enc.Flush()
		if err == nil {
			err = enc.Error()
		}
	}
	closeErr := f.Close()
	if err != nil {
		os.Remove(path)
		return err
	}
	if closeErr != nil {
		os.Remove(path)
	}
	return closeErr
}

// A lone empty field must be quoted: standard CSV readers skip blank lines.
// Flush earlier records before writing it, preserving ordering and write errors.
func writeCSVRecord(enc *csv.Writer, dst io.Writer, values []string) error {
	if len(values) == 1 && values[0] == "" {
		enc.Flush()
		if err := enc.Error(); err != nil {
			return err
		}
		_, err := dst.Write([]byte("\"\"\n"))
		return err
	}
	return enc.Write(values)
}

// Only typed numeric cells with a complete numeric representation bypass text
// protection. Never parse through float64: large integers/decimals stay exact.
var csvNumber = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

func spreadsheetText(value, columnType string) string {
	numeric := false
	switch strings.Split(columnType, "(")[0] {
	case "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT", "FLOAT", "DOUBLE", "DECIMAL":
		numeric = true
	}
	if numeric && csvNumber.MatchString(value) {
		return value
	}
	for _, c := range value {
		// Spreadsheet imports can discard leading whitespace/control characters.
		if unicode.IsControl(c) || c == '\ufeff' {
			return "'" + value
		}
		if unicode.IsSpace(c) {
			continue
		}
		if strings.ContainsRune("=+-@＝＋－＠", c) {
			return "'" + value
		}
		break
	}
	return value
}
