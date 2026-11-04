"""Verify query history in headless Chrome with synthetic IPC."""

import http.server
import json
import subprocess
import threading
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = root / "artifacts/visual/query-library"
out.mkdir(parents=True, exist_ok=True)
mock = r"""globalThis.libraryAudit={calls:0,finish:null};
globalThis.entries=[{id:'one',scope:{kind:'file',path:'/example/sample.parquet'},sql:"SELECT '<img onerror=x>', 9223372036854775807, NULL, '' FROM data",updated:'2026-11-02T12:00:00Z',history:true,favorite:false},{id:'legacy',scope:{kind:'file',path:'/example/sample.parquet'},sql:'SELECT count(*) FROM data',updated:'2026-11-01T12:00:00Z',history:false,favorite:true},{id:'other',name:'Other workspace',scope:{kind:'workspace',path:'/example/other'},sql:'SELECT * FROM workspace.data',updated:'2026-10-31T12:00:00Z',history:false,favorite:true}];
globalThis.mygo={on:()=>()=>{},call:async(method,...args)=>{
 const columns=[{name:'id',type:'BIGINT'},{name:'竹子 \" <img>',type:'VARCHAR'}];
 if(method==='Workbench.Language')return new URLSearchParams(location.search).get('lang')||'en';
 if(method==='Workbench.Display')return {zoomPercent:100,dataFontSize:13};
 if(method==='Workbench.Appearance')return 'system';
 if(method==='Workbench.Resources')return {memoryMiB:256,memoryAuto:false,tempGiB:0,timeoutSeconds:300};
 if(method==='Workbench.ResourceLimits')return {physicalMiB:8192,maxMemoryMiB:8192,autoMemoryMiB:2048};
 if(method==='Workbench.DiskLimits')return {detected:true,availableGiB:20,reserveGiB:1,maxTempGiB:19,autoTempGiB:4};
 if(method==='Workbench.RestoreWorkspaces')return {workspaces:[],warning:''};
 if(method==='Workbench.ListConnections')return [];
 if(method==='Workbench.InitialFile')return '';
 if(method==='Workbench.Open'){libraryAudit.opens=(libraryAudit.opens||0)+1;return {path:'/example/sample.parquet',name:'sample.parquet',rows:'3',bytes:'1000',rowGroups:'1',columns};}
 if(method==='Workbench.QueryLibrary')return entries;
 if(method==='Workbench.SaveNamedQuery' || method==='Workbench.RenameSavedQuery'){
  libraryAudit.calls++;
  return new Promise(resolve=>{libraryAudit.finish=()=>{
   const e=entries.find(e=>e.id==='one');e.favorite=true;
   e.name=method==='Workbench.SaveNamedQuery'?args[2]:args[1];resolve();
  }});
 }
 if(method==='Workbench.Query'){
  libraryAudit.queries=(libraryAudit.queries||0)+1;
  const page={columns,rows:[['1','A'],['2',''],['3',null]],offset:0,pageSize:100,more:false,elapsedMS:1};

  return page;
 }
 throw Error(method);
}};
const timer=setInterval(async()=>{if(document.body.dataset.ready!=='true')return;clearInterval(timer);
 const wait=()=>new Promise(resolve=>{const t=setInterval(()=>{if(document.querySelector('#busy').hidden){clearInterval(t);resolve()}},20)});
 document.querySelector('#open').click(); await wait();
 document.querySelector('#query-history').click();
 document.body.dataset.libraryReady='true';
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
    captures = []
    for name, width, height, lang, dark in [
        ("queries-light", 1100, 800, "en", False),
        ("queries-dark", 1100, 800, "zh-CN", True),
        ("queries-small", 390, 600, "en", False),
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
        captures.append(cmd[2:])
    subprocess.run(
        [
            "node",
            str(root / "scripts/visual/capture-runner.mjs"),
            str(Path(__file__).with_name("visual-capture.mjs")),
            json.dumps(captures),
            "40",
        ],
        check=True,
        timeout=40 * len(captures) + 10,
    )

finally:
    server.shutdown()
