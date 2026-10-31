"""Verify keyboard sorting with deferred IPC in isolated headless Chrome."""

import http.server
import subprocess
import threading
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = root / "artifacts/visual/sort-focus"
out.mkdir(parents=True, exist_ok=True)
mock = r"""globalThis.sortAudit={calls:0,finish:null};
globalThis.mygo={on:()=>()=>{},call:async(method,...args)=>{
 const columns=[{name:'id',type:'BIGINT'},{name:'竹子 \" <img>',type:'VARCHAR'}];
 if(method==='Workbench.Language')return new URLSearchParams(location.search).get('lang')||'en';
 if(method==='Workbench.Appearance')return 'system';
 if(method==='Workbench.Resources')return {memoryMiB:256,memoryAuto:false,tempGiB:0,timeoutSeconds:300};
 if(method==='Workbench.ResourceLimits')return {physicalMiB:8192,maxMemoryMiB:8192,autoMemoryMiB:2048};
 if(method==='Workbench.DiskLimits')return {detected:true,availableGiB:20,reserveGiB:1,maxTempGiB:19,autoTempGiB:4};
 if(method==='Workbench.RestoreWorkspaces')return {workspaces:[],warning:''};
 if(method==='Workbench.ListConnections')return [];
 if(method==='Workbench.InitialFile')return '';
 if(method==='Workbench.Open')return {path:'/example/sample.parquet',name:'sample.parquet',rows:'3',bytes:'1000',rowGroups:'1',columns};
 if(method==='Workbench.Query'){
  sortAudit.calls++;
  const page={columns,rows:[['1','A'],['2',''],['3',null]],offset:0,pageSize:100,more:false,elapsedMS:1};
  if(args[0].sort)return new Promise(resolve=>{sortAudit.finish=()=>resolve(page)});
  return page;
 }
 throw Error(method);
}};
const timer=setInterval(async()=>{if(document.body.dataset.ready!=='true')return;clearInterval(timer);
 const wait=()=>new Promise(resolve=>{const t=setInterval(()=>{if(document.querySelector('#busy').hidden){clearInterval(t);resolve()}},20)});
 document.querySelector('#open').click(); await wait();
 const header=()=>document.querySelectorAll('#grid th button')[1];
 header().focus(); document.body.dataset.sortReady='true';
},30);"""


class Handler(http.server.BaseHTTPRequestHandler):
    """Serve built frontend assets with mock IPC for headless layout checks."""

    def do_GET(self):
        """Serve the requested asset and inject the fixture into the HTML entry point."""
        path = self.path.split("?")[0]
        if path == "/mock.js":
            body = mock.encode()
            mime = "text/javascript"
        elif path == "/":
            body = (
                (root / "frontend/dist/index.html")
                .read_text()
                .replace("<head>", '<head><script src="/mock.js"></script>')
                .encode()
            )
            mime = "text/html"
        else:
            file = (root / "frontend/dist" / path.lstrip("/")).resolve()
            if not file.is_relative_to(root / "frontend/dist") or not file.is_file():
                self.send_error(404)
                return
            body = file.read_bytes()
            mime = (
                "text/css"
                if file.suffix == ".css"
                else "text/javascript"
                if file.suffix == ".js"
                else "image/png"
            )
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        """Suppress routine HTTP access logs during visual checks."""
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    for name, width, height, lang, dark in [
        ("sort-light", 1100, 800, "en", False),
        ("sort-dark", 1100, 800, "zh-CN", True),
        ("sort-small", 390, 600, "en", False),
    ]:
        cmd = [
            "node",
            str(Path(__file__).with_name("visual-capture.mjs")),
            f"http://127.0.0.1:{server.server_port}/?lang={lang}{'&active=1' if dark else ''}",
            str(out),
            name,
            str(width),
            str(height),
            "dark" if dark else "light",
        ]
        subprocess.run(cmd, check=True, timeout=40)

finally:
    server.shutdown()
