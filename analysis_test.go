package main

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/cloudstoragetest"
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAnalysisFullQueryAcrossScopes(t *testing.T) {
	w, dialogs, dir := workbench(t)
	w.folders = workspace.New(t.TempDir())
	info, err := w.useWorkspace(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	server := cloudstoragetest.New(dir)
	defer server.Close()
	w.remote = cloudstorage.NewWithTransport(t.TempDir(), &cloudstoragetest.Vault{}, server.Transport)
	extension, _ := filepath.Abs("build/extensions/httpfs.duckdb_extension")
	w.engine.SetHTTPFS(extension)
	cloud, err := w.ConnectR2(ctx, cloudstoragetest.Input())
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(w.initial)
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range []string{"file", "workspace", "cloud-file", "cloud-workspace"} {
		t.Run(scope, func(t *testing.T) {
			request := engine.Request{SQL: `SELECT city, order_id, 9007199254740993::BIGINT AS exact FROM data`, Limit: 1, Offset: 10, FilterColumn: "city", FilterValue: "Kyoto"}
			switch scope {
			case "file":
				_, err = w.OpenPath(ctx, w.initial)
			case "cloud-file":
				_, err = w.OpenWorkspaceFile(ctx, cloud.Root, "orders.parquet")
			}
			if err != nil {
				t.Fatal(err)
			}
			if scope == "workspace" || scope == "cloud-workspace" {
				root := info.Root
				if scope == "cloud-workspace" {
					root = cloud.Root
				}
				request.SQL = `SELECT city, order_id, 9007199254740993::BIGINT AS exact FROM workspace."orders.parquet" UNION ALL SELECT city, order_id, 0 FROM workspace."orders.parquet" WHERE false`
				_, err = w.QueryWorkspace(ctx, root, request)
			} else {
				_, err = w.Query(ctx, request)
			}
			if err != nil {
				t.Fatal(err)
			}
			preview := w.last
			profile, err := w.ProfileColumn(ctx, "city")
			if err != nil || profile.Total != "60" || profile.Nulls != "0" || profile.Distinct != "1" || *profile.Min != "Kyoto" || profile.Values[0].Count != "60" {
				t.Fatal(profile, err)
			}
			for _, operation := range []string{"COUNT", "SUM", "AVG", "MIN", "MAX"} {
				metric := "exact"
				if operation == "AVG" {
					metric = "order_id"
				}
				pivot, err := w.Pivot(ctx, engine.PivotSpec{Group: "city", Operation: operation, Metric: metric})
				if err != nil || len(pivot.Rows) != 1 || *pivot.Rows[0][0] != "Kyoto" {
					t.Fatal(pivot, err)
				}
				want := map[string]string{"COUNT": "60", "AVG": "1119.0", "SUM": "540431955284459580", "MIN": "9007199254740993", "MAX": "9007199254740993"}[operation]
				if *pivot.Rows[0][1] != want {
					t.Fatal(operation, pivot.Rows[0])
				}
			}
			for _, format := range []string{"json", "jsonl", "csv", "tsv"} {
				dialogs.path = filepath.Join(dir, "pivot-"+scope+"."+format)
				if _, err = w.ExportPivotAs(ctx, format); err != nil {
					t.Fatal(err)
				}
				if _, err = w.ExportPivotAs(ctx, format); err == nil {
					t.Fatal("pivot export overwrote file")
				}
			}
			if w.last != preview || len(w.last.Rows) != 1 {
				t.Fatal("analysis replaced the normal export snapshot")
			}
			if _, err = w.Query(ctx, engine.Request{SQL: "SELECT missing FROM data", Limit: 1}); err == nil || w.last != preview {
				t.Fatal("failure lost query context", err)
			}
		})
	}
	after, err := os.ReadFile(w.initial)
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("source changed", err)
	}
}

func TestAnalysisFailuresAndSnapshotIsolation(t *testing.T) {
	w, d, dir := workbench(t)
	ctx := context.Background()
	if _, err := w.ProfileColumn(ctx, "x"); err == nil {
		t.Fatal("missing query")
	}
	if _, err := w.Pivot(ctx, engine.PivotSpec{}); err == nil {
		t.Fatal("missing pivot query")
	}
	if _, err := w.ExportPivotAs(ctx, "json"); err == nil {
		t.Fatal("missing pivot snapshot")
	}
	if _, err := w.ExportPivotAs(ctx, "xml"); err == nil {
		t.Fatal("invalid format")
	}
	w.opMu.Lock()
	_, profileErr := w.ProfileColumn(ctx, "city")
	_, pivotErr := w.Pivot(ctx, engine.PivotSpec{})
	_, exportErr := w.ExportPivotAs(ctx, "json")
	w.opMu.Unlock()
	if profileErr == nil || pivotErr == nil || exportErr == nil {
		t.Fatal("concurrent operation accepted")
	}
	if _, err := w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	readPage(t, w, `SELECT city AS "a""b", order_id FROM data`)
	if _, err := w.ProfileColumn(ctx, `a"b`); err != nil {
		t.Fatal("quoted column", err)
	}
	for _, spec := range []engine.PivotSpec{{Group: "missing", Operation: "COUNT"}, {Group: `a"b`, Operation: "SUM", Metric: "missing"}, {Group: `a"b`, Operation: "COUNT); COPY data TO 'x'--"}} {
		if _, err := w.Pivot(ctx, spec); err == nil {
			t.Fatal("unsafe aggregate", spec)
		}
	}
	pivot, err := w.Pivot(ctx, engine.PivotSpec{Group: `a"b`, Operation: "COUNT"})
	if err != nil {
		t.Fatal(err)
	}
	if path, err := w.ExportPivotAs(ctx, "json"); err != nil || path != "" {
		t.Fatal("save canceled", path, err)
	}
	d.err = errors.New("dialog failure")
	if _, err = w.ExportPivotAs(ctx, "json"); !errors.Is(err, d.err) {
		t.Fatal(err)
	}
	d.err = nil
	d.path = filepath.Join(dir, "wrong.csv")
	if _, err = w.ExportPivotAs(ctx, "json"); err == nil {
		t.Fatal("extension")
	}
	d.path = filepath.Join(dir, "cancel.json")
	d.onSave = w.Cancel
	if _, err = w.ExportPivotAs(ctx, "json"); err == nil {
		t.Fatal("cancel ignored")
	}
	d.onSave = nil
	if _, err = os.Stat(d.path); !os.IsNotExist(err) {
		t.Fatal("partial pivot published")
	}
	if w.pivot != pivot {
		t.Fatal("export failure lost snapshot")
	}
	if _, err = w.Query(ctx, engine.Request{SQL: `SELECT city FROM data`, Limit: 1, FilterColumn: "city", FilterValue: "Kyoto' OR true--"}); err != nil {
		t.Fatal(err)
	}
	profile, err := w.ProfileColumn(ctx, "city")
	if err != nil || profile.Total != "0" || w.pivot != nil {
		t.Fatal("filter must remain bound, and query replaces pivot eligibility", profile, err)
	}
	// A wide grouped result must fail before reaching IPC, even though a single
	// preview row and each individual value are within their respective budgets.
	if _, err = w.Query(ctx, engine.Request{SQL: `SELECT i, i::VARCHAR || repeat('x',60000) AS wide FROM range(100) t(i)`, Limit: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err = w.Pivot(ctx, engine.PivotSpec{Group: "wide", Operation: "COUNT"}); err == nil || !strings.Contains(err.Error(), "4 MiB") {
		t.Fatal("pivot output byte budget", err)
	}
	if _, err = w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	if _, err = w.ExportPivotAs(ctx, "json"); err == nil {
		t.Fatal("stale pivot after source switch")
	}
}

func TestAnalysisDelimitedInput(t *testing.T) {
	w, _, dir := workbench(t)
	path := filepath.Join(dir, "stats.tsv")
	if err := os.WriteFile(path, []byte("category\tamount\nA\t9007199254740993.25\nA\t1.25\nB\t\n"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := w.OpenPath(ctx, path); err != nil {
		t.Fatal(err)
	}
	readPage(t, w, "SELECT category, amount::DECIMAL(38,2) AS amount FROM data")
	profile, err := w.ProfileColumn(ctx, "amount")
	if err != nil || profile.Total != "3" || profile.Nulls != "1" || profile.Distinct != "2" {
		t.Fatal(profile, err)
	}
	pivot, err := w.Pivot(ctx, engine.PivotSpec{Group: "category", Operation: "SUM", Metric: "amount"})
	if err != nil || *pivot.Rows[0][1] != "9007199254740994.50" || pivot.Rows[1][1] != nil {
		t.Fatal(pivot, err)
	}
	w.folders = workspace.New(t.TempDir())
	folder, err := w.useWorkspace(dir)
	if err != nil {
		t.Fatal(err)
	}
	query := `SELECT s.category, p.order_id FROM workspace."stats.tsv" s JOIN workspace."orders.parquet" p ON s.category='A' LIMIT 300`
	if _, err = w.QueryWorkspace(ctx, folder.Root, engine.Request{SQL: query, Limit: 1}); err != nil {
		t.Fatal(err)
	}
	profile, err = w.ProfileColumn(ctx, "category")
	if err != nil || profile.Total != "300" || profile.Distinct != "1" {
		t.Fatal("mixed-format join and explicit SQL limit", profile, err)
	}
	pivot, err = w.Pivot(ctx, engine.PivotSpec{Group: "category", Operation: "COUNT"})
	if err != nil || len(pivot.Rows) != 1 || *pivot.Rows[0][1] != "300" {
		t.Fatal("mixed-format pivot", pivot, err)
	}
}

func TestAnalysisActiveCancellation(t *testing.T) {
	w, _, _ := workbench(t)
	ctx := context.Background()
	if _, err := w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	for _, operation := range []string{"profile", "pivot"} {
		t.Run(operation, func(t *testing.T) {
			// Preview is bounded, while the aggregate must consume billions of
			// generated rows. Interrupt native execution, not a canceled input.
			readPage(t, w, `SELECT i%2 AS group_id, i FROM range(10000000000) t(i)`)
			preview := w.last
			finished := make(chan error, 1)
			go func() {
				if operation == "profile" {
					_, err := w.ProfileColumn(ctx, "group_id")
					finished <- err
				} else {
					_, err := w.Pivot(ctx, engine.PivotSpec{Group: "group_id", Operation: "SUM", Metric: "i"})
					finished <- err
				}
			}()
			ticker := time.NewTicker(100 * time.Millisecond)
			defer ticker.Stop()
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
		wait:
			for {
				select {
				case err := <-finished:
					if err == nil || (!strings.Contains(strings.ToLower(err.Error()), "interrupt") && !strings.Contains(strings.ToLower(err.Error()), "cancel")) {
						t.Fatal("native aggregate did not report cancellation", err)
					}
					break wait
				case <-ticker.C:
					w.Cancel()
				case <-deadline.C:
					w.Cancel()
					t.Fatal("native aggregate did not stop promptly")
				}
			}
			if w.last != preview || w.pivot != nil {
				t.Fatal("cancellation changed the selected snapshot")
			}
			readPage(t, w, "SELECT city FROM data")
			profile, err := w.ProfileColumn(ctx, "city")
			if err != nil || profile.Total != "240" {
				t.Fatal("analysis recovery after cancellation", profile, err)
			}
		})
	}
}

func TestAnalysisNullsLimitsAndExactDecimals(t *testing.T) {
	w, d, dir := workbench(t)
	ctx := context.Background()
	if _, err := w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	readPage(t, w, `SELECT i%3 AS grp, CASE WHEN i%5=0 THEN NULL ELSE 1234567890123456789.123456789::DECIMAL(38,9) END AS amount FROM range(240) t(i)`)
	profile, err := w.ProfileColumn(ctx, "amount")
	if err != nil || profile.Total != "240" || profile.Nulls != "48" || profile.Distinct != "1" || *profile.Min != "1234567890123456789.123456789" || *profile.Max != *profile.Min || profile.Values[0].Count != "192" {
		t.Fatal(profile, err)
	}
	pivot, err := w.Pivot(ctx, engine.PivotSpec{Group: "grp", Operation: "SUM", Metric: "amount"})
	if err != nil || len(pivot.Rows) != 3 || *pivot.Rows[0][1] != "79012344967901234503.901234496" {
		t.Fatal(pivot, err)
	}
	d.path = filepath.Join(dir, "exact.json")
	if _, err = w.ExportPivotAs(ctx, "json"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(d.path)
	var exported engine.Result
	if err != nil || json.Unmarshal(b, &exported) != nil || *exported.Rows[0][1] != *pivot.Rows[0][1] {
		t.Fatal("exact export", err)
	}
	for _, query := range []string{`SELECT NULL AS v FROM range(10)`, `SELECT 1 AS v WHERE false`} {
		readPage(t, w, query)
		profile, err = w.ProfileColumn(ctx, "v")
		if err != nil || profile.Distinct != "0" || profile.Min != nil || profile.Max != nil {
			t.Fatal(profile, err)
		}
	}
	readPage(t, w, `SELECT i AS v FROM range(10001) t(i)`)
	if _, err = w.ProfileColumn(ctx, "v"); err == nil {
		t.Fatal("high-cardinality profile silently truncated")
	}
	if _, err = w.Pivot(ctx, engine.PivotSpec{Group: "v", Operation: "COUNT"}); err == nil {
		t.Fatal("high-cardinality pivot silently truncated")
	}
	readPage(t, w, `SELECT i%30 AS v FROM range(1000) t(i)`)
	profile, err = w.ProfileColumn(ctx, "v")
	if err != nil || len(profile.Values) != 20 || profile.Total != "1000" || profile.Distinct != "30" || *profile.Min != "0" || *profile.Max != "29" || profile.Values[0].Count != "34" {
		t.Fatal(profile, err)
	}
	child, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = w.ProfileColumn(child, "v"); err == nil {
		t.Fatal("cancel ignored")
	}
	if _, err = w.Pivot(ctx, engine.PivotSpec{Group: "v", Operation: "COUNT"}); err != nil {
		t.Fatal("recovery", err)
	}
}
