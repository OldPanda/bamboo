//go:build !darwin

package updater

import "testing"

func TestManualUpdatesRequireExplicitAction(t *testing.T) {
	old := openReleasePage
	defer func() { openReleasePage = old }()
	calls := 0
	openReleasePage = func() error { calls++; return nil }
	c := New()
	if err := c.Start(); err != nil {
		t.Fatal(err)
	}
	status, err := c.Status()
	if err != nil || status.Automatic || status.Available || !status.CanCheck || status.Version == "" {
		t.Fatal(status, err)
	}
	if calls != 0 {
		t.Fatal("background browser launch")
	}
	if c.SetAutomatic(true) == nil {
		t.Fatal("unsupported automatic updates accepted")
	}
	if err := c.Check(); err != nil || calls != 1 {
		t.Fatal("explicit release page check", err)
	}
}
