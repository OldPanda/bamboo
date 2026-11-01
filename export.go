package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/privatefs"
	"bufio"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/egoist/mygo"
)

func exportFormat(format string) bool {
	return format == "json" || format == "jsonl" || format == "csv" || format == "tsv"
}

// ExportProgress reports completed rows as an exact decimal string. It never
// counts or executes a second query and does not promise a known total.
type ExportProgress struct {
	Running bool   `json:"running"`
	Rows    string `json:"rows"`
}

// GetExportProgress can be polled while a full export owns the operation gate.
func (w *Workbench) GetExportProgress() ExportProgress {
	w.mu.Lock()
	defer w.mu.Unlock()
	return ExportProgress{Running: w.exportRunning, Rows: strconv.FormatInt(w.exportRows, 10)}
}

// ExportFullAs re-executes the last successful query, including its filter and
// sort, within its original workspace. Pagination is excluded. Source changes
// outside Bamboo are not transactional. The destination is created only after
// the bounded stream finishes successfully; existing files are never replaced.
func (w *Workbench) ExportFullAs(parent context.Context, format string) (string, error) {
	if !exportFormat(format) {
		return "", errors.New("choose JSON, JSONL, CSV or TSV export format")
	}
	if !w.opMu.TryLock() {
		return "", errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	w.mu.Lock()
	if w.last == nil {
		w.mu.Unlock()
		return "", errors.New("run a query before exporting")
	}
	r, root := w.lastRequest, w.lastRoot
	ctx, cancel := context.WithCancel(parent)
	w.remoteCancel = cancel
	w.exportRows, w.exportRunning = 0, true
	w.mu.Unlock()
	defer func() {
		cancel()
		w.mu.Lock()
		w.remoteCancel = nil
		w.exportRunning = false
		w.mu.Unlock()
	}()
	path, err := w.dialogs.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(parent), Title: w.languageText("Export complete result as ", "导出完整结果为 ") + strings.ToUpper(format), DefaultPath: "bamboo-result." + format, Filters: []mygo.FileFilter{{Name: strings.ToUpper(format), Extensions: []string{format}}}})
	if err != nil || path == "" {
		return "", err
	}
	if filepath.Ext(path) != "."+format {
		return "", fmt.Errorf("export filename must end in .%s", format)
	}
	err = writeFullExport(ctx, path, format, func(sink engine.RowSink) error {
		progress := func(cols []engine.Column, row []*string) error {
			if err := sink(cols, row); err != nil {
				return err
			}
			if row != nil {
				w.mu.Lock()
				w.exportRows++
				w.mu.Unlock()
			}
			return nil
		}
		if root == "" {
			return w.engine.Stream(ctx, r, progress)
		}
		if isRemoteWorkspace(root) {
			return w.engine.StreamRemoteWorkspace(ctx, r, w.remote.Resolver(root), progress)
		}
		return w.engine.StreamWorkspace(ctx, r, func(relative string) (string, error) { return w.folders.Resolve(root, relative) }, progress)
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

func writeFullExport(ctx context.Context, path, format string, stream func(engine.RowSink) error) (failure error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	// Stage beside the destination so publishing is an exclusive same-volume
	// hard link. A crash can leave a visibly partial file, never a completed name.
	f, err := privatefs.CreateTemp(filepath.Dir(path), ".bamboo-export-partial-*")
	if err != nil {
		return err
	}
	defer func() {
		f.Close()
		if err := os.Remove(f.Name()); err != nil {
			failure = errors.Join(failure, fmt.Errorf("remove partial export %q: %w", f.Name(), err))
		}
	}()
	buffer := bufio.NewWriterSize(f, 64*1024)
	writer := &resultWriter{dst: buffer, format: format}
	if err := stream(writer.write); err != nil {
		return err
	}
	if err := writer.finish(); err != nil {
		return err
	}
	if err := buffer.Flush(); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Link(f.Name(), path); err != nil {
		return fmt.Errorf("could not publish export; choose a new filename on a filesystem supporting hard links: %w", err)
	}
	return nil
}

type resultWriter struct {
	dst    io.Writer
	format string
	csv    *csv.Writer
	rows   int64
}

func (w *resultWriter) write(cols []engine.Column, row []*string) error {
	enc := json.NewEncoder(w.dst)
	if row == nil {
		switch w.format {
		case "json":
			if _, err := io.WriteString(w.dst, "{\"columns\":"); err != nil {
				return err
			}
			if err := enc.Encode(cols); err != nil {
				return err
			}
			_, err := io.WriteString(w.dst, ",\"rows\":[")
			return err
		case "jsonl":
			return enc.Encode(struct {
				Columns []engine.Column `json:"columns"`
			}{cols})
		default:
			w.csv = csv.NewWriter(w.dst)
			if w.format == "tsv" {
				w.csv.Comma = '\t'
			}
			header := make([]string, len(cols))
			for i, c := range cols {
				header[i] = spreadsheetText(c.Name, "")
			}
			return writeCSVRecord(w.csv, w.dst, header)
		}
	}
	if len(row) != len(cols) {
		return errors.New("result columns do not match row values")
	}
	w.rows++
	switch w.format {
	case "json":
		if w.rows > 1 {
			if _, err := io.WriteString(w.dst, ","); err != nil {
				return err
			}
		}
		return enc.Encode(row)
	case "jsonl":
		return enc.Encode(struct {
			Row []*string `json:"row"`
		}{row})
	default:
		values := make([]string, len(row))
		for i, value := range row {
			if value != nil {
				values[i] = spreadsheetText(*value, cols[i].Type)
			}
		}
		return writeCSVRecord(w.csv, w.dst, values)
	}
}

func (w *resultWriter) finish() error {
	if w.csv != nil {
		w.csv.Flush()
		return w.csv.Error()
	}
	if w.format == "json" {
		_, err := io.WriteString(w.dst, "],\"more\":false,\"offset\":0}\n")
		return err
	}
	return nil
}
