package main

import (
	"encoding/json"
	"fmt"
	"github.com/egoist/mygo"
	"os"
	"path/filepath"
	"time"
)

// Smoke is opt-in developer automation against the real WKWebView and IPC.
func smoke(win *mygo.Window) {
	dir := os.Getenv("BAMBOO_SMOKE")
	os.MkdirAll(dir, 0755)
	report := map[string]any{}
	defer func() {
		b, _ := json.MarshalIndent(report, "", "  ")
		os.WriteFile(filepath.Join(dir, "desktop-smoke.json"), b, 0644)
		mygo.App.Quit()
	}()
	ready := false
	for i := 0; i < 100; i++ {
		v, err := win.Page().Eval(`document.body.dataset.ready === 'true'`)
		if err == nil && v == true {
			ready = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		report["error"] = "frontend did not become ready"
		return
	}
	script, err := os.ReadFile("scripts/smoke.js")
	if err != nil {
		report["error"] = err.Error()
		return
	}
	result, err := win.Page().Eval(string(script))
	report["result"] = result
	if err != nil {
		report["error"] = fmt.Sprint(err)
		return
	}
	mygo.Theme.SetSource(mygo.ThemeDark)
	time.Sleep(200 * time.Millisecond)
	png, err := win.CapturePage()
	if err != nil {
		report["captureError"] = err.Error()
	} else {
		os.WriteFile(filepath.Join(dir, "bamboo-desktop.png"), png, 0644)
	}
	mygo.Theme.SetSource(mygo.ThemeLight)
	time.Sleep(200 * time.Millisecond)
	capture := func(name string) {
		b, err := win.CapturePage()
		if err != nil {
			report[name] = err.Error()
			return
		}
		os.WriteFile(filepath.Join(dir, name+".png"), b, 0644)
	}
	report["lightButtonStyle"], _ = win.Page().Eval(`({background:getComputedStyle(document.getElementById("export")).backgroundColor,color:getComputedStyle(document.getElementById("export")).color,surface:getComputedStyle(document.documentElement).getPropertyValue("--surface"),appearance:getComputedStyle(document.getElementById("export")).appearance,dark:matchMedia("(prefers-color-scheme: dark)").matches})`)
	capture("bamboo-light")
	win.Page().Eval(`document.getElementById('tab-schema').click()`)
	capture("bamboo-schema")
	mygo.Theme.SetSource(mygo.ThemeDark)
	time.Sleep(200 * time.Millisecond)
	capture("bamboo-schema-dark")
	mygo.Theme.SetSource(mygo.ThemeLight)
	time.Sleep(200 * time.Millisecond)
	win.Page().Eval(`document.getElementById('tab-explore').click(); document.getElementById('sql').value='SELECT city, count(*) AS orders, sum(amount) AS revenue FROM data GROUP BY city ORDER BY revenue DESC'; document.getElementById('run').click()`)
	for i := 0; i < 100; i++ {
		v, _ := win.Page().Eval(`document.getElementById('busy').hidden`)
		if v == true {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	capture("bamboo-sql")
	mygo.Theme.SetSource(mygo.ThemeDark)
	time.Sleep(200 * time.Millisecond)
	capture("bamboo-sql-dark")
	mygo.Theme.SetSource(mygo.ThemeLight)
	time.Sleep(200 * time.Millisecond)
	win.SetSize(700, 640)
	time.Sleep(200 * time.Millisecond)
	report["narrowLayout"], _ = win.Page().Eval(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth})`)
	capture("bamboo-narrow")
	win.Page().Eval(`document.getElementById("workspace").scrollTop=10000`)
	time.Sleep(100 * time.Millisecond)
	report["narrowFooterReachable"], _ = win.Page().Eval(`document.querySelector(".table-footer").getBoundingClientRect().bottom <= innerHeight + 1`)
	capture("bamboo-narrow-results")

}
