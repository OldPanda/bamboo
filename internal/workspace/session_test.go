package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func TestSessionPersistenceAndFailures(t *testing.T) {
	s, root, config := fixture(t)
	one := filepath.Join(root, "one.parquet")
	two := filepath.Join(root, "two.parquet")
	for _, f := range []string{one, two, one} {
		if err := s.Remember(f, true); err != nil {
			t.Fatal(err)
		}
	}
	restored, err := New(config).RestoreAll()
	if err != nil || !reflect.DeepEqual(restored.Session.Files, []string{one, two}) || restored.Session.Active != one {
		t.Fatal(restored, err)
	}
	before, _ := os.ReadFile(s.path)
	// Restore must not rewrite state, even when a root becomes unavailable.
	os.Rename(root, root+"-offline")
	defer os.Rename(root+"-offline", root)
	restored, err = New(config).RestoreAll()
	after, _ := os.ReadFile(s.path)
	if err != nil || restored.Warning == "" || len(restored.Workspaces) != 1 || string(before) != string(after) {
		t.Fatal(restored, err)
	}
	if err = s.Forget(two); err != nil {
		t.Fatal(err)
	}
	if err = s.Forget(one); err != nil {
		t.Fatal(err)
	}
	restored, err = New(config).RestoreAll()
	if err != nil || len(restored.Session.Files) != 0 || restored.Session.Active != "" {
		t.Fatal(restored, err)
	}
	original := s.path
	s.path = filepath.Join(t.TempDir(), "blocked", "state")
	os.WriteFile(filepath.Dir(s.path), nil, 0600)
	for _, run := range []func() error{func() error { return s.Remember(one, true) }, func() error { return s.Forget(one) }, func() error { return s.ForgetRoot(root) }} {
		if run() == nil {
			t.Fatal("write error ignored")
		}
	}
	s.path = original
	restored, _ = New(config).RestoreAll()
	if len(restored.Session.Files) != 0 {
		t.Fatal("failed change committed")
	}
}

func TestSessionMigrationOwnershipAndLimits(t *testing.T) {
	s, root, config := fixture(t)
	nested := filepath.Join(root, "nested")
	os.Mkdir(nested, 0700)
	nestedInfo, err := s.Use(nested)
	if err != nil {
		t.Fatal(err)
	}
	nested = nestedInfo.Root
	outside := filepath.Join(t.TempDir(), "outside.parquet")
	local := filepath.Join(root, "one.parquet")
	child := filepath.Join(nested, "two.parquet")
	cloud := "s3://synthetic/orders.parquet"
	// Older versions persist one active path per root, with no session field.
	s.data.Profiles[root].Active = "one.parquet"
	s.data.Last = root
	if err = s.write(s.data); err != nil {
		t.Fatal(err)
	}
	s = New(config)
	r, _ := s.RestoreAll()
	v := s.MigrateSession(append(r.Workspaces, Info{Root: "s3://synthetic", Active: "orders.parquet"}))
	if !slices.Contains(v.Files, local) || !slices.Contains(v.Files, cloud) || v.Active != cloud {
		t.Fatal(v)
	}
	for _, f := range []string{outside, child, cloud} {
		if err = s.Remember(f, true); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.CloseFile(root, "../outside.parquet"); err == nil {
		t.Fatal("close escaped workspace")
	}
	if err = s.Close(root); err != nil {
		t.Fatal(err)
	}
	r, _ = New(config).RestoreAll()
	if slices.Contains(r.Session.Files, local) || !slices.Contains(r.Session.Files, child) || !slices.Contains(r.Session.Files, outside) {
		t.Fatal(r.Session)
	}
	if err = s.ForgetRoot("s3://synthetic"); err != nil {
		t.Fatal(err)
	}
	if s.data.Session.Active != "" || slices.Contains(s.data.Session.Files, cloud) {
		t.Fatal(s.data.Session)
	}
	if err = s.Remember(nested, false); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(nested); err != nil || s.data.Session.Active != "" {
		t.Fatal(err, s.data.Session)
	}
	if err = s.Remember("relative.parquet", true); err == nil {
		t.Fatal("relative path accepted")
	}
	for len(s.data.Session.Files) < 128 {
		if err = s.Remember(filepath.Join(root, strings.Repeat("a", len(s.data.Session.Files)+1)+".parquet"), true); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.Remember(filepath.Join(root, "overflow.parquet"), true); err == nil {
		t.Fatal("unbounded session")
	}
	if err = s.Leave(); err != nil || len(s.data.Session.Files) != 0 {
		t.Fatal(err)
	}
}

func TestInvalidSessionsPreserveBytes(t *testing.T) {
	config := t.TempDir()
	good := filepath.Join(config, "ok.parquet")
	for _, v := range []*Session{
		{Files: []string{"relative.parquet"}}, {Files: []string{good, good}},
		{Files: []string{filepath.Join(config, "bad.txt")}}, {Active: "../root"},
		{Files: make([]string, 129)}, {Active: "s3://../escape"},
		{Active: "s3:///bad"}, {Active: "r2://root/../bad"}, {Active: "s3://root\\bad"},
		{Active: "s3://"}, {Active: strings.Repeat("a", 32769)}, {Active: "/bad\x00"},
	} {
		raw, _ := json.Marshal(state{Version: 1, Profiles: map[string]*profile{}, Session: v})
		filename := filepath.Join(config, "workspaces.json")
		os.WriteFile(filename, raw, 0600)
		s := New(config)
		if _, err := s.RestoreAll(); err == nil {
			t.Fatal("accepted", v)
		}
		if err := s.Remember(good, true); err == nil {
			t.Fatal("overwrote invalid state")
		}
		_ = s.MigrateSession([]Info{{Root: config}})
		after, _ := os.ReadFile(filename)
		if string(raw) != string(after) {
			t.Fatal("invalid state changed")
		}
	}
}

func TestCloudSessionCloseRollback(t *testing.T) {
	s := New(t.TempDir())
	file := "r2://test/orders.parquet"
	if err := s.Remember(file, true); err != nil {
		t.Fatal(err)
	}
	previous, _ := os.ReadFile(s.path)
	for _, root := range []bool{false, true} {
		location := file
		if root {
			location = "r2://test"
		}
		if err := s.CloseCloud(location, root, func() error { return os.ErrPermission }); err == nil {
			t.Fatal("cloud failure hidden")
		}
		after, _ := os.ReadFile(s.path)
		if string(previous) != string(after) {
			t.Fatal("failed cloud close lost session")
		}
	}
	if err := s.CloseCloud(file, false, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if len(s.data.Session.Files) != 0 {
		t.Fatal("closed cloud file retained")
	}
	s.path = filepath.Join(t.TempDir(), "blocked", "state")
	os.WriteFile(filepath.Dir(s.path), nil, 0600)
	if err := s.CloseCloud("r2://test", true, func() error { t.Fatal("cloud changed after session write failure"); return nil }); err == nil {
		t.Fatal("write failure ignored")
	}
}

func TestLegacyOverlappingSelectionsDeduplicate(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	file := filepath.Join(nested, "orders.parquet")
	s := New(t.TempDir())
	v := s.MigrateSession([]Info{{Root: root, Active: "nested/orders.parquet"}, {Root: nested, Active: "orders.parquet"}})
	if !reflect.DeepEqual(v.Files, []string{file}) || v.Active != file {
		t.Fatal(v)
	}
	if err := s.Remember(file, true); err != nil {
		t.Fatal(err)
	}
	if _, err := New(filepath.Dir(s.path)).RestoreAll(); err != nil {
		t.Fatal(err)
	}
}
