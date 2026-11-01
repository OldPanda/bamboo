"""Verify display preferences and effective zoom layouts in headless Chrome using synthetic IPC data."""

import http.server
import subprocess
import threading
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = root / "artifacts/visual/display"
out.mkdir(parents=True, exist_ok=True)
mock = """globalThis.mygo={on:()=>()=>{},call:async(method)=>{
 const columns=[{name:'id',type:'BIGINT'}];
 if(method==='Workbench.Language')return new URLSearchParams(location.search).get('lang')||'en';
 if(method==='Workbench.Resources')return {memoryMiB:256,memoryAuto:false,tempGiB:0,timeoutSeconds:300};
 if(method==='Workbench.DiskLimits')return {detected:true,availableGiB:20,reserveGiB:1,maxTempGiB:19,autoTempGiB:4};
 if(method==='Workbench.ResourceLimits')return {physicalMiB:8192,maxMemoryMiB:8192,autoMemoryMiB:2048};
 if(method==='Workbench.Display')return {zoomPercent:200,dataFontSize:20};
 if(method==='Workbench.Appearance')return 'system';
 if(method==='Workbench.InitialFile')return '';
 if(method==='Workbench.RestoreWorkspaces')return {workspaces:[],warning:''};
 if(method==='Workbench.ListConnections')return [];
 if(method==='Workbench.Open'||method==='Workbench.OpenPath')return {path:'/example/sample.tsv',name:'sample.tsv',rows:'',bytes:'1000',rowGroups:'',columns,textOptions:{delimiter:'\\t',header:true,inferTypes:false}};
 if(method==='Workbench.SetDisplay')return new Promise(resolve=>{globalThis.finishDisplay=()=>resolve()});
 if(method==='Workbench.GetExportProgress')return {running:true,rows:'120'};
 if(method==='Workbench.Query')return {columns,rows:[['9223372036854775807']],offset:0,pageSize:100,more:true,elapsedMS:1};
 throw Error(method);
}};
const timer=setInterval(async()=>{if(document.body.dataset.ready!=='true')return;clearInterval(timer);
 document.getElementById('open').click();
 while(!document.getElementById('busy').hidden)await new Promise(resolve=>setTimeout(resolve,20));
 document.getElementById('settings').click();
 const d=document.getElementById('settings-dialog'),r=d.getBoundingClientRect();
 const reachable=[...d.querySelectorAll('#display-form button,#display-form input')].every(n=>{n.scrollIntoView({block:'nearest'});const b=n.getBoundingClientRect();return b.left>=r.left && b.right<=r.right && b.bottom<=innerHeight && b.top>=0});
 document.getElementById('display-form').scrollIntoView({block:'start'});
 const pre=document.createElement('pre');pre.id='visual-result';pre.hidden=true;
 pre.textContent=JSON.stringify({width:innerWidth,lang:document.documentElement.lang,dialogOverflow:d.scrollWidth>d.clientWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth,reachable});document.body.append(pre);
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
        ("display-light", 1100, 800, "en", False),
        ("display-dark", 640, 410, "zh-CN", True),
        ("display-narrow", 467, 347, "zh-CN", False),
        ("display-max-zoom", 350, 260, "en", False),
    ]:
        cmd = [
            "node",
            str(Path(__file__).with_name("visual-capture.mjs")),
            f"http://127.0.0.1:{server.server_port}/?lang={lang}{'&custom=1' if dark else ''}",
            str(out),
            name,
            str(width),
            str(height),
            "dark" if dark else "light",
        ]
        subprocess.run(cmd, check=True, timeout=40)

finally:
    server.shutdown()
