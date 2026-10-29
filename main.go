// Bamboo is a desktop workbench for local and cloud Parquet data.
package main

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/engine"
	"bamboo/internal/updater"
	"bamboo/internal/workspace"
	"embed"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/egoist/mygo"
)

//go:embed frontend/dist
var frontend embed.FS

var remoteStoreFactory = cloudstorage.New

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
	if err := e.Configure(loadResources(config), nil); err != nil {
		log.Fatal(err)
	}
	executable, _ := os.Executable()
	extension := filepath.Join(filepath.Dir(executable), "extensions", "httpfs.duckdb_extension")
	if filepath.Base(filepath.Dir(executable)) == "MacOS" {
		extension = filepath.Join(filepath.Dir(executable), "..", "Resources", "extensions", "httpfs.duckdb_extension")
	}
	e.SetHTTPFS(extension)
	updates := updater.New()
	w := &Workbench{updates: updates, remote: remoteStoreFactory(config, cloudstorage.NewVault()), engine: e, initial: initial, dialogs: mygo.Dialog, folders: workspace.New(config), configDir: config}
	mygo.Theme.SetSource(loadAppearance(config))
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
		win := mygo.NewWindow(mygo.WindowOptions{Title: "Bamboo", Width: 1280, Height: 820, MinWidth: 700, MinHeight: 520, URL: "/", BackgroundColor: "light-dark(#ffffff, #262626)"})
		if runtime.GOOS == "darwin" {
			keepWindowInDock(mygo.App, win)
		}
		win.Page().OnWillNavigate(func(ev *mygo.NavigateEvent) { ev.PreventDefault() })
		win.Page().SetWindowOpenHandler(func(mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
		if os.Getenv("BAMBOO_SMOKE") == "" {
			if err := updates.Start(); err != nil {
				log.Printf("Automatic updates: %v", err)
			}
		}
		if os.Getenv("BAMBOO_SMOKE") != "" {
			go smoke(win)
		}
	})
	if err = mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
