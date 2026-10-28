package main

import "github.com/egoist/mygo"

// desktopLifecycleApp provides the application events used by the macOS window policy.
type desktopLifecycleApp interface {
	OnBeforeQuit(func(*mygo.QuitEvent)) func()
	OnActivate(func(bool)) func()
}

// desktopLifecycleWindow retains the workbench while its window is hidden.
type desktopLifecycleWindow interface {
	OnClose(func(*mygo.CloseEvent)) func()
	Hide()
	Show()
}

// keepWindowInDock preserves the workbench on close and permits explicit app quit.
// MyGo delivers these lifecycle callbacks on its main thread.
func keepWindowInDock(app desktopLifecycleApp, win desktopLifecycleWindow) {
	quitting := false
	app.OnBeforeQuit(func(*mygo.QuitEvent) { quitting = true })
	win.OnClose(func(event *mygo.CloseEvent) {
		if quitting {
			return
		}
		event.PreventDefault()
		win.Hide()
	})
	app.OnActivate(func(hasVisibleWindows bool) {
		if !quitting && !hasVisibleWindows {
			win.Show()
		}
	})
}
