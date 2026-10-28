package cloudstorage

import (
	"bamboo/internal/workspace"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSavedConnections(t *testing.T) {
	var denied atomic.Bool
	s, _, v := testStore(t, func(w http.ResponseWriter, _ *http.Request) {
		if denied.Load() {
			w.WriteHeader(403)
			return
		}
		fmt.Fprint(w, listingXML("data/"))
	})
	ctx := context.Background()
	info, err := s.SaveConnection(ctx, "", input())
	if err != nil {
		t.Fatal(err)
	}
	root := info.Root
	list, err := s.Connections()
	if err != nil || len(list) != 1 || list[0].Open || list[0].Provider != "r2" {
		t.Fatal(list, err)
	}
	raw, _ := json.Marshal(list)
	if strings.Contains(string(raw), "synthetic") || strings.Contains(string(raw), "secretKey") {
		t.Fatal("credentials exposed")
	}
	if active, _ := s.Restore(); len(active) != 0 {
		t.Fatal(active)
	}
	if _, err = s.Saved(root, "."); err == nil {
		t.Fatal("closed query allowed")
	}
	if err = s.Save(root, ".", workspace.Query{}); err == nil {
		t.Fatal("closed write allowed")
	}
	if _, err = s.client(root); err == nil {
		t.Fatal("closed reader allowed")
	}
	if err = s.TestConnection(ctx, root); err != nil {
		t.Fatal(err)
	}
	reopened, err := s.OpenConnection(ctx, root)
	if err != nil || reopened.Root != root {
		t.Fatal(reopened, err)
	}
	q := workspace.Query{Draft: "SELECT 42", Applied: "SELECT 42"}
	if err = s.Save(root, ".", q); err != nil {
		t.Fatal(err)
	}
	edit := input()
	edit.Name = "Renamed"
	edit.AccessKey = ""
	edit.SecretKey = ""
	if _, err = s.SaveConnection(ctx, root, edit); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Saved(root, "."); got != q {
		t.Fatal("name edit lost query")
	}
	if v.data[root].SecretKey != input().SecretKey {
		t.Fatal("blank edit lost credentials")
	}
	edit.Prefix = "changed"
	if _, err = s.SaveConnection(ctx, root, edit); err == nil {
		t.Fatal("changed live location")
	}
	if err = s.Close(root); err != nil {
		t.Fatal(err)
	}
	reloaded := New(filepath.Dir(s.filename), v)
	if active, _ := reloaded.Restore(); len(active) != 0 {
		t.Fatal(active)
	}
	if connections, e := reloaded.Connections(); e != nil || len(connections) != 1 || connections[0].Open {
		t.Fatal(connections, e)
	}
	if len(v.data) != 1 {
		t.Fatal("closing deleted credentials")
	}
	if _, err = s.SaveConnection(ctx, root, edit); err != nil {
		t.Fatal(err)
	}
	if s.profiles[root].Info.Location != "r2://test-bucket/changed" || len(s.profiles[root].Queries) != 0 {
		t.Fatal("location change not reset")
	}
	edit.SecretKey = "replacement"
	edit.AccessKey = "replacement-access"
	if _, err = s.SaveConnection(ctx, root, edit); err != nil {
		t.Fatal(err)
	}
	if v.data[root].SecretKey != "replacement" {
		t.Fatal("rotation not saved")
	}
	denied.Store(true)
	edit.Name = "must not save"
	if _, err = s.SaveConnection(ctx, root, edit); err == nil || s.profiles[root].Info.Name == edit.Name {
		t.Fatal("failed test persisted")
	}
	if _, err = s.OpenConnection(ctx, root); err == nil {
		t.Fatal("failed reopen")
	}
	denied.Store(false)
	if _, err = s.Connect(ctx, edit); err != nil || len(s.profiles) != 1 {
		t.Fatal("duplicate edited location", err)
	}
	if err = s.DeleteConnection(root); err != nil || len(v.data) != 0 {
		t.Fatal("delete retained key", err)
	}
	if _, err = s.SaveConnection(ctx, root, edit); err == nil {
		t.Fatal("missing edit accepted")
	}
	if err = s.TestConnection(ctx, root); err == nil {
		t.Fatal("missing test accepted")
	}
	if _, err = s.OpenConnection(ctx, root); err == nil {
		t.Fatal("missing open accepted")
	}
}

func TestConnectionEditFailures(t *testing.T) {
	s, _, v := testStore(t, func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, listingXML("data/")) })
	ctx := context.Background()
	first, _ := s.SaveConnection(ctx, "", input())
	secondInput := input()
	secondInput.Bucket = "second-bucket"
	second, _ := s.SaveConnection(ctx, "", secondInput)
	if _, err := s.SaveConnection(ctx, second.Root, input()); err == nil {
		t.Fatal("duplicate target accepted")
	}
	edit := input()
	edit.AccessKey = ""
	edit.SecretKey = ""
	delete(v.data, first.Root)
	if _, err := s.SaveConnection(ctx, first.Root, edit); err == nil {
		t.Fatal("missing credentials accepted")
	}
	if err := s.TestConnection(ctx, first.Root); err == nil {
		t.Fatal("missing vault test")
	}
	v.data[first.Root] = Credentials{AccessKey: input().AccessKey, SecretKey: input().SecretKey}
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	s.filename = filepath.Join(blocker, "settings.json")
	if _, err := s.OpenConnection(ctx, first.Root); err == nil || !s.profiles[first.Root].Closed {
		t.Fatal("failed reopen changed state")
	}
	rotated := input()
	rotated.SecretKey = "new-secret"
	if _, err := s.SaveConnection(ctx, first.Root, rotated); err == nil || v.data[first.Root].SecretKey != input().SecretKey {
		t.Fatal("rotation rollback failed")
	}
}

func TestInvalidConnectionSettingsStayIntact(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "r2-workspaces.json")
	os.WriteFile(filename, []byte("broken configuration"), 0600)
	s := New(dir, &memoryVault{data: map[string]Credentials{}})
	if _, err := s.SaveConnection(context.Background(), "", input()); err == nil {
		t.Fatal("invalid settings overwritten")
	}
	b, _ := os.ReadFile(filename)
	if string(b) != "broken configuration" {
		t.Fatal(string(b))
	}
}

func TestOriginalLocationAfterConnectionMove(t *testing.T) {
	s, _, v := testStore(t, func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, listingXML("data/")) })
	ctx := context.Background()
	first, err := s.SaveConnection(ctx, "", input())
	if err != nil {
		t.Fatal(err)
	}
	moved := input()
	moved.Prefix = "moved"
	moved.SecretKey = "moved-secret"
	if _, err = s.SaveConnection(ctx, first.Root, moved); err != nil {
		t.Fatal(err)
	}
	original, err := s.SaveConnection(ctx, "", input())
	if err != nil || original.Root == first.Root || len(s.profiles) != 2 {
		t.Fatal(original, err)
	}
	if s.profiles[first.Root].Config.Prefix != "moved" || v.data[first.Root].SecretKey != "moved-secret" {
		t.Fatal("original location overwrote moved connection")
	}
	duplicate, err := s.Connect(ctx, input())
	if err != nil || duplicate.Root != original.Root || len(s.profiles) != 2 {
		t.Fatal("original location not deduplicated", err)
	}
	reloaded := New(filepath.Dir(s.filename), v)
	list, err := reloaded.Connections()
	if err != nil || len(list) != 2 {
		t.Fatal(list, err)
	}
}
