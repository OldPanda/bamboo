package main

import (
	"bamboo/internal/privatefs"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
)

// DisplayPreferences controls native page zoom and table text size. The SQL
// editor remains one pixel larger than the table, preserving the default design.
type DisplayPreferences struct {
	ZoomPercent  int `json:"zoomPercent"`
	DataFontSize int `json:"dataFontSize"`
}

func defaultDisplay() DisplayPreferences {
	return DisplayPreferences{ZoomPercent: 100, DataFontSize: 13}
}

func (d DisplayPreferences) validate() error {
	if d.ZoomPercent < 75 || d.ZoomPercent > 200 || d.DataFontSize < 12 || d.DataFontSize > 20 {
		return errors.New("display zoom must be 75–200% and data text 12–20 px")
	}
	return nil
}

func loadDisplay(dir string) DisplayPreferences {
	f, err := os.Open(filepath.Join(dir, "display.json"))
	if err != nil {
		return defaultDisplay()
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 513))
	var d DisplayPreferences
	if err != nil || len(b) > 512 || json.Unmarshal(b, &d) != nil || d.validate() != nil {
		return defaultDisplay()
	}
	return d
}

// Display returns persisted display preferences, falling back to normal size
// when absent or invalid. It does not alter the native page.
func (w *Workbench) Display() DisplayPreferences { return loadDisplay(w.configDir) }

// SetDisplay privately saves validated preferences, then applies the native
// WebView zoom to the calling window. Failed saves preserve the current zoom.
func (w *Workbench) SetDisplay(ctx context.Context, display DisplayPreferences) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := display.validate(); err != nil {
		return err
	}
	if w.configDir == "" {
		return errors.New("could not save display preferences")
	}
	if err := os.MkdirAll(w.configDir, 0700); err != nil {
		return errors.New("could not save display preferences")
	}
	f, err := privatefs.CreateTemp(w.configDir, ".display-*")
	if err != nil {
		return errors.New("could not save display preferences")
	}
	defer os.Remove(f.Name())
	if err = json.NewEncoder(f).Encode(display); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return errors.New("could not save display preferences")
	}
	if err = os.Rename(f.Name(), filepath.Join(w.configDir, "display.json")); err != nil {
		return errors.New("could not save display preferences")
	}
	if window := mygo.CallerWindow(ctx); window != nil {
		window.Page().SetZoomFactor(float64(display.ZoomPercent) / 100)
	}
	return nil
}
