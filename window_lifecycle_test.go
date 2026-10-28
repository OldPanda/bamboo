package main

import (
	"testing"

	"github.com/egoist/mygo"
)

type lifecycleAppStub struct {
	beforeQuit func(*mygo.QuitEvent)
	activate   func(bool)
}

func (a *lifecycleAppStub) OnBeforeQuit(fn func(*mygo.QuitEvent)) func() {
	a.beforeQuit = fn
	return func() {}
}
func (a *lifecycleAppStub) OnActivate(fn func(bool)) func() {
	a.activate = fn
	return func() {}
}

type lifecycleWindowStub struct {
	close        func(*mygo.CloseEvent)
	visible      bool
	shows, hides int
}

func (w *lifecycleWindowStub) OnClose(fn func(*mygo.CloseEvent)) func() {
	w.close = fn
	return func() {}
}
func (w *lifecycleWindowStub) Hide() { w.visible = false; w.hides++ }
func (w *lifecycleWindowStub) Show() { w.visible = true; w.shows++ }

func TestWindowCloseAndDockReopen(t *testing.T) {
	app, win := &lifecycleAppStub{}, &lifecycleWindowStub{visible: true}
	keepWindowInDock(app, win)
	app.activate(true)
	if win.shows != 0 {
		t.Fatal("activating a visible workbench must not open another window")
	}
	for i := 0; i < 3; i++ {
		event := &mygo.CloseEvent{}
		win.close(event)
		if !event.DefaultPrevented() || win.visible {
			t.Fatal("window close must hide the workbench without destroying it")
		}
		app.activate(false)
		if !win.visible || win.shows != i+1 {
			t.Fatal("Dock activation must restore the existing workbench")
		}
	}
}

func TestExplicitQuitClosesVisibleAndHiddenWindows(t *testing.T) {
	for _, hidden := range []bool{false, true} {
		t.Run(map[bool]string{false: "visible", true: "hidden"}[hidden], func(t *testing.T) {
			app, win := &lifecycleAppStub{}, &lifecycleWindowStub{visible: true}
			keepWindowInDock(app, win)
			if hidden {
				win.close(&mygo.CloseEvent{})
			}
			hides := win.hides
			quit := &mygo.QuitEvent{}
			app.beforeQuit(quit)
			closeEvent := &mygo.CloseEvent{}
			win.close(closeEvent)
			if quit.DefaultPrevented() || closeEvent.DefaultPrevented() || win.hides != hides {
				t.Fatal("explicit quit must proceed through native window destruction")
			}
			app.activate(false)
			if win.shows != 0 {
				t.Fatal("activation during quit must not reopen the workbench")
			}
		})
	}
}
