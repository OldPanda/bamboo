package main

import (
	"bamboo/internal/engine"
	"embed"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
)

//go:embed all:frontend/dist
var frontend embed.FS

func main() {
	mygo.App.SetName("Bamboo")
	e := engine.New()
	defer e.Close()
	initial := ""
	if len(os.Args) == 3 && os.Args[1] == "--file" {
		initial, _ = filepath.Abs(os.Args[2])
	}
	w := &Workbench{engine: e, initial: initial, dialogs: mygo.Dialog}
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
