package updater

import "testing"

func TestNativeErrors(t *testing.T) {
	if New() == nil || nativeError(0) != nil {
		t.Fatal("success not recognized")
	}
	for code, message := range map[int]string{1: "updates are unavailable in this build", 2: "an update check is already in progress", 3: "could not start the updater", 99: "could not start the updater"} {
		if err := nativeError(code); err == nil || err.Error() != message {
			t.Fatalf("code %d: %v", code, err)
		}
	}
}
