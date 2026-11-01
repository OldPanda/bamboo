package datafile

import "testing"

func TestTextOptions(t *testing.T) {
	for _, p := range []string{"a.parquet", "A.CSV", "a.TSV"} {
		if !Supported(p) {
			t.Fatal(p)
		}
	}
	if Supported("a.json") || IsText("a.parquet") {
		t.Fatal("unsupported format")
	}
	for _, p := range []string{"a.csv", "a.TSV"} {
		o := DefaultTextOptions(p)
		if !o.Header || o.InferTypes || o.Validate() != nil {
			t.Fatal(o)
		}
		if p == "a.TSV" && o.Delimiter != "\t" {
			t.Fatal(o)
		}
	}
	for _, d := range []string{"", ",", "\t", ";", "|"} {
		if err := (TextOptions{Delimiter: d}).Validate(); err != nil {
			t.Fatal(err)
		}
	}
	for _, d := range []string{"\n", "'", "xx", "\\t"} {
		if err := (TextOptions{Delimiter: d}).Validate(); err == nil {
			t.Fatal(d)
		}
	}
}
