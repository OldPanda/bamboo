//go:build cloudsmoke || r2smoke

package main

import "testing"

func TestCloudFixtureDirectory(t *testing.T) {
	for _, tc := range []struct{ name, current, legacy, want string }{
		{"current", "/cloud", "", "/cloud"},
		{"legacy", "", "/legacy", "/legacy"},
		{"current takes precedence", "/cloud", "/legacy", "/cloud"},
		{"unset", "", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("BAMBOO_CLOUD_FIXTURES", tc.current)
			t.Setenv("BAMBOO_R2_FIXTURES", tc.legacy)
			if got := cloudFixtureDirectory(); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
