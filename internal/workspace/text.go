package workspace

import (
	"bamboo/internal/datafile"
	"errors"
	"path/filepath"
)

// TextOptions returns saved decoding preferences for a canonical local path.
// An unreadable settings file is an error, never a silent fallback interpretation.
func (s *Store) TextOptions(path string) (datafile.TextOptions, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadErr != nil {
		return datafile.TextOptions{}, s.loadErr
	}
	if options, ok := s.data.TextOptions[path]; ok {
		return options, nil
	}
	return datafile.DefaultTextOptions(path), nil
}

// SetTextOptions atomically remembers one file's interpretation, without opening
// or writing the source. Callers supply the already resolved canonical path.
func (s *Store) SetTextOptions(path string, options datafile.TextOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !filepath.IsAbs(path) || !datafile.IsText(path) {
		return errors.New("choose a local CSV or TSV file")
	}
	if err := options.Validate(); err != nil {
		return err
	}
	d := s.copy()
	if _, ok := d.TextOptions[path]; !ok && len(d.TextOptions) >= 256 {
		return errors.New("maximum of 256 remembered text files reached")
	}
	d.TextOptions[path] = options
	return s.commit(d)
}
