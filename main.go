package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/r2"
	"bamboo/internal/workspace"
	"embed"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
)

//go:embed all:frontend/dist
var frontend embed.FS

var remoteStoreFactory = r2.New

func main() {
	mygo.App.SetName("Bamboo")
	e := engine.New()
	defer e.Close()
	initial := ""
	if len(os.Args) == 3 && os.Args[1] == "--file" {
		initial, _ = filepath.Abs(os.Args[2])
	}
	config := os.Getenv("BAMBOO_CONFIG_DIR")
	if config == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			log.Fatal(err)
		}
		config = filepath.Join(base, "Bamboo")
	}
	executable, _ := os.Executable()
	extension := filepath.Join(filepath.Dir(executable), "extensions", "httpfs.duckdb_extension")
	if filepath.Base(filepath.Dir(executable)) == "MacOS" {
		extension = filepath.Join(filepath.Dir(executable), "..", "Resources", "extensions", "httpfs.duckdb_extension")
	}
	e.SetHTTPFS(extension)
	w := &Workbench{remote: remoteStoreFactory(config, r2.NewVault()), engine: e, initial: initial, dialogs: mygo.Dialog, folders: workspace.New(config)}
	if len(os.Args) == 3 && os.Args[1] == "--workspace" {
		if _, err := w.useWorkspace(os.Args[2]); err != nil {
			log.Fatal(err)
		}
	}
	mygo.Bind(w)
	web, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	mygo.SetFrontend(web)
	mygo.App.WhenReady(func() {
		win := mygo.NewWindow(mygo.WindowOptions{Title: "Bamboo", Width: 1280, Height: 820, MinWidth: 700, MinHeight: 520, URL: "/", BackgroundColor: "#f7f8f5"})
		win.Page().OnWillNavigate(func(ev *mygo.NavigateEvent) { ev.PreventDefault() })
		win.Page().SetWindowOpenHandler(func(mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
		if os.Getenv("BAMBOO_SMOKE") != "" {
			go smoke(win)
		}
	})
	if err = mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
