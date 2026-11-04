"""Exercise real WKWebView/MyGo IPC in an invisible, isolated test process.

Uses a Go overlay to replace only main for the harness build. The release App,
user settings, Keychain, updater and existing windows are never used.
"""

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts/query-library-native"
HARNESS = r"""
package main
import (
 "bamboo/internal/engine"
 "bamboo/internal/fixtures"
 "bamboo/internal/workspace"
 "context"
 "crypto/sha256"
 "encoding/json"
 "fmt"
 "os"
 "path/filepath"
 "testing/fstest"
 "time"
 "github.com/egoist/mygo"
)
func main() {
 root,phase,report := os.Args[1],os.Args[2],os.Args[3]
 if phase=="initial" {if err:=fixtures.Generate(filepath.Join(root,"data"),false);err!=nil{panic(err)}}
 original,err:=os.ReadFile(filepath.Join(root,"data/orders.parquet"));if err!=nil{panic(err)}
 e:=engine.New();defer e.Close()
 config:=filepath.Join(root,"config")
 w:=&Workbench{engine:e,configDir:config,folders:workspace.New(config)}
 e.SetTextOptionsResolver(w.textOptions)
 mygo.App.SetName("Bamboo Query IPC Test")
 mygo.App.SetActivationPolicy(mygo.ActivationPolicyProhibited)
 mygo.Bind(w)
 mygo.SetFrontend(fstest.MapFS{"index.html":&fstest.MapFile{Data:[]byte("<!doctype html><title>Isolated IPC fixture</title>")}})
 mygo.App.WhenReady(func(){
  win:=mygo.NewWindow(mygo.WindowOptions{Title:"Invisible IPC fixture",Width:700,Height:520,Hidden:true,URL:"/"})
  go func(){
   defer mygo.App.Quit()
   ctx,cancel:=context.WithTimeout(context.Background(),35*time.Second);defer cancel()
   var ready bool
   for i:=0;i<100;i++ {
    value,err:=win.Page().EvalContext(ctx,"typeof mygo !== 'undefined' && !!mygo.call")
    if err==nil&&value==true {ready=true;break};time.Sleep(50*time.Millisecond)
   }
   if !ready {panic("native bridge not ready")}
   script,err:=os.ReadFile(filepath.Join("scripts","query-library-smoke.js"));if err!=nil{panic(err)}
   directory,_:=json.Marshal(root);mode,_:=json.Marshal(phase)
   code:=fmt.Sprintf("const smokeDirectory=%s;const workspacePhase=%s;\n%s",directory,mode,script)
   result,err:=win.Page().EvalContext(ctx,code)
   if err!=nil {panic(err)}
   current,err:=os.ReadFile(filepath.Join(root,"data/orders.parquet"));if err!=nil{panic(err)}
   if sha256.Sum256(original)!=sha256.Sum256(current){panic("source fixture changed")}
   body,err:=json.MarshalIndent(result,"","  ");if err!=nil{panic(err)}
   if err=os.WriteFile(report,body,0600);err!=nil{panic(err)}
  }()
 })
 if err:=mygo.App.Run();err!=nil{panic(err)}
}
"""


def main():
    """Build and run two bounded invisible processes sharing only synthetic settings."""
    OUT.mkdir(parents=True, exist_ok=True)
    attempt = Path(tempfile.mkdtemp(prefix="attempt-", dir=OUT))
    with tempfile.TemporaryDirectory(prefix="bamboo-query-ipc-") as temporary:
        fixture = Path(temporary)
        source = fixture / "main.go"
        source.write_bytes(subprocess.check_output(["gofmt"], input=HARNESS.encode()))
        overlay = fixture / "overlay.json"
        overlay.write_text(
            json.dumps({"Replace": {str(ROOT / "main.go"): str(source)}})
        )
        binary = ROOT / "build/query-library-native"
        env = {**os.environ, "GOCACHE": str(ROOT / "build/go-cache")}
        subprocess.run(
            [
                "python3",
                "scripts/go-release.py",
                "build",
                "-trimpath",
                f"-overlay={overlay}",
                "-o",
                str(binary),
                ".",
            ],
            cwd=ROOT,
            env=env,
            check=True,
            timeout=180,
        )
        before = None
        for phase in ("initial", "restart"):
            report = attempt / f"{phase}.json"
            report.unlink(missing_ok=True)
            with (attempt / f"{phase}.log").open("w") as log:
                subprocess.run(
                    [str(binary), str(fixture), phase, str(report)],
                    cwd=ROOT,
                    env=env,
                    check=True,
                    timeout=45,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
            result = json.loads(report.read_text())
            if len(result["checks"]) != (10 if phase == "initial" else 5):
                raise RuntimeError("incomplete native IPC checks")
            source_file = fixture / "data/orders.parquet"
            digest = hashlib.sha256(source_file.read_bytes()).hexdigest()
            if before is not None and before != digest:
                raise RuntimeError("native IPC changed the source fixture")
            before = digest
            print(f"{phase}: {len(result['checks'])} native IPC checks passed")
        (attempt / "source-integrity.json").write_text(
            json.dumps({"unchangedAcrossRestart": True, "sha256": before})
        )

    (OUT / "latest.json").write_text(
        json.dumps({"attempt": attempt.name, "checks": 15})
    )


if __name__ == "__main__":
    main()
