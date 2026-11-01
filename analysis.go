package main

import (
	"bamboo/internal/engine"
	"context"
	"errors"
	"fmt"
	"math/big"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/egoist/mygo"
)

// ValueCount is one exact value and its full-query frequency. NULL has a nil Value.
type ValueCount struct {
	Value *string `json:"value"`
	Count string  `json:"count"`
}

// ColumnProfile is an exact full-query profile, never a sample or page summary.
// Distinct excludes NULL. Values holds at most the 20 most frequent groups,
// including NULL; equal-frequency groups retain the database's value order.
type ColumnProfile struct {
	Total    string       `json:"total"`
	Nulls    string       `json:"nulls"`
	Distinct string       `json:"distinct"`
	Min      *string      `json:"min"`
	Max      *string      `json:"max"`
	Values   []ValueCount `json:"values"`
}

func (w *Workbench) streamAnalysis(ctx context.Context, request engine.Request, root string, sink engine.RowSink) error {
	if root == "" {
		return w.engine.Stream(ctx, request, sink)
	}
	if isRemoteWorkspace(root) {
		return w.engine.StreamRemoteWorkspace(ctx, request, w.remote.Resolver(root), sink)
	}
	return w.engine.StreamWorkspace(ctx, request, func(relative string) (string, error) { return w.folders.Resolve(root, relative) }, sink)
}

// ProfileColumn explicitly reruns the captured successful query and its bound
// filter, within the same scope. More than 10,000 distinct non-NULL values fails
// instead of returning a partial profile. Query budgets and cancellation apply.
func (w *Workbench) ProfileColumn(ctx context.Context, column string) (*ColumnProfile, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	w.mu.Lock()
	if w.last == nil {
		w.mu.Unlock()
		return nil, errors.New("run a query before analyzing")
	}
	request, root := engine.ProfileRequest(w.lastRequest, column), w.lastRoot
	w.mu.Unlock()
	profile := &ColumnProfile{Nulls: "0", Values: []ValueCount{}}
	total, distinct := new(big.Int), 0
	err := w.streamAnalysis(ctx, request, root, func(_ []engine.Column, row []*string) error {
		if row == nil {
			return nil
		}
		count, ok := new(big.Int).SetString(*row[1], 10)
		if !ok || count.Sign() < 0 {
			return errors.New("invalid aggregate count")
		}
		total.Add(total, count)
		if row[0] == nil {
			profile.Nulls = *row[1]
		} else {
			distinct++
			if distinct > engine.MaxProfileValues {
				return errors.New("profile exceeds 10,000 distinct values; filter the query first")
			}
			if profile.Min == nil {
				profile.Min = row[0]
			}
			profile.Max = row[0]
		}
		profile.Values = append(profile.Values, ValueCount{Value: row[0], Count: *row[1]})
		sort.SliceStable(profile.Values, func(i, j int) bool {
			a, _ := new(big.Int).SetString(profile.Values[i].Count, 10)
			b, _ := new(big.Int).SetString(profile.Values[j].Count, 10)
			return a.Cmp(b) > 0
		})
		if len(profile.Values) > 20 {
			profile.Values = profile.Values[:20]
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	profile.Total, profile.Distinct = total.String(), strconv.Itoa(distinct)
	return profile, nil
}

// Pivot computes all groups of an explicit aggregate over the captured query.
// It rejects more than 1,000 groups or 4 MiB of values before exposing a result.
// The normal preview/export remains intact; pivot export owns a separate snapshot.
func (w *Workbench) Pivot(ctx context.Context, spec engine.PivotSpec) (*engine.Result, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	w.mu.Lock()
	if w.last == nil {
		w.mu.Unlock()
		return nil, errors.New("run a query before analyzing")
	}
	request, root := engine.PivotRequest(w.lastRequest, spec), w.lastRoot
	w.mu.Unlock()
	result, size := &engine.Result{Rows: [][]*string{}}, 0
	err := w.streamAnalysis(ctx, request, root, func(columns []engine.Column, row []*string) error {
		if row == nil {
			result.Columns = columns
			return nil
		}
		if len(result.Rows) >= engine.MaxPivotGroups {
			return errors.New("pivot exceeds 1,000 groups; filter the query first")
		}
		for _, value := range row {
			if value != nil {
				size += len(*value)
			}
		}
		if size > engine.MaxResult {
			return errors.New("pivot exceeds 4 MiB; filter the query first")
		}
		result.Rows = append(result.Rows, row)
		return nil
	})
	if err != nil {
		return nil, err
	}
	w.mu.Lock()
	w.pivot = result
	w.mu.Unlock()
	return result, nil
}

// ExportPivotAs saves the selected complete pivot snapshot without re-executing
// source queries or replacing the normal preview's export target.
func (w *Workbench) ExportPivotAs(parent context.Context, format string) (string, error) {
	if !exportFormat(format) {
		return "", errors.New("choose JSON, JSONL, CSV or TSV export format")
	}
	if !w.opMu.TryLock() {
		return "", errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	w.mu.Lock()
	result := w.pivot
	ctx, cancel := context.WithCancel(parent)
	w.remoteCancel = cancel
	w.mu.Unlock()
	defer func() {
		cancel()
		w.mu.Lock()
		w.remoteCancel = nil
		w.mu.Unlock()
	}()
	if result == nil {
		return "", errors.New("build a pivot before exporting")
	}
	path, err := w.dialogs.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(parent), Title: w.languageText("Export pivot as ", "导出透视结果为 ") + strings.ToUpper(format), DefaultPath: "bamboo-pivot." + format, Filters: []mygo.FileFilter{{Name: strings.ToUpper(format), Extensions: []string{format}}}})
	if err != nil || path == "" {
		return "", err
	}
	if filepath.Ext(path) != "."+format {
		return "", fmt.Errorf("export filename must end in .%s", format)
	}
	err = writeFullExport(ctx, path, format, func(sink engine.RowSink) error {
		if err := sink(result.Columns, nil); err != nil {
			return err
		}
		for _, row := range result.Rows {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := sink(result.Columns, row); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return path, nil
}
