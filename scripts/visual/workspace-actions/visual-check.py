"""Verify workspace-actions layouts in headless Chrome using synthetic IPC data."""

import http.server
import subprocess
import tempfile
import threading
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = root / "artifacts/visual/workspace-actions"
out.mkdir(parents=True, exist_ok=True)
mock = """globalThis.mygo={on:()=>()=>{},call:async(method,...args)=>{
 if(method==='Workbench.Language')return new URLSearchParams(location.search).get('lang')||'en';
 if(method==='Workbench.Resources')return {memoryMiB:28672,memoryAuto:!new URLSearchParams(location.search).has('custom'),tempGiB:4,timeoutSeconds:300};
 if(method==='Workbench.DiskLimits')return {detected:true,availableGiB:257,reserveGiB:1,maxTempGiB:256,autoTempGiB:64};
 if(method==='Workbench.ResourceLimits')return {physicalMiB:32768,maxMemoryMiB:32768,autoMemoryMiB:8192};
 if(method==='Workbench.Appearance')return 'system';
 if(method==='Workbench.InitialFile')return '';
 if(method==='Workbench.RestoreWorkspaces')return {workspaces:[{root:'/example/coverage-fixtures',name:'coverage-fixtures',active:'.'}],warning:''};
 if(method==='Workbench.ListDirectory')return {entries:[],more:false,next:0};
 if(method==='Workbench.OpenWorkspaceQuery')return {draft:'',applied:''};
 if(method==='Workbench.ClearPreview')return;
 if(method==='Workbench.ListConnections')return [];
 if(method==='Workbench.SetResources')return;
 throw Error(method);
}};
const timer=setInterval(()=>{if(document.body.dataset.ready!=='true')return;clearInterval(timer);

 const heading=document.querySelector('.folder-heading'),group=heading.querySelector('.folder-actions');
 const h=heading.getBoundingClientRect(),g=group.getBoundingClientRect();
 const controls=[...group.querySelectorAll('button')];
 const rightAligned=Math.abs(h.right-g.right)<1;
 const iconsOnly=controls.length===3&&controls.every(b=>b.querySelector('svg')&&!b.textContent.trim()&&b.getAttribute('aria-label'));
 const oneRow=g.top>=h.top&&g.bottom<=h.bottom;
 const noOverflow=heading.scrollWidth<=heading.clientWidth;
 const result={rightAligned,iconsOnly,oneRow,noOverflow,width:innerWidth,order:controls.map(b=>b.dataset.control)};
 const pre=document.createElement('pre');pre.id='visual-result';pre.hidden=true;pre.textContent=JSON.stringify(result);document.body.append(pre);
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
        ("workspace-light", 1100, 800, "en", False),
        ("workspace-dark", 1100, 800, "zh-CN", True),
        ("workspace-small", 390, 600, "en", False),
    ]:
        with tempfile.TemporaryDirectory(prefix="bamboo-headless-") as profile:
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
