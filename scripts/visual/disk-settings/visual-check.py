"""Verify disk-settings layouts in headless Chrome using synthetic IPC data."""

import http.server
import subprocess
import tempfile
import threading
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = root / "artifacts/visual/disk-settings"
out.mkdir(parents=True, exist_ok=True)
mock = """globalThis.mygo={on:()=>()=>{},call:async(method,...args)=>{
 if(method==='Workbench.Language')return new URLSearchParams(location.search).get('lang')||'en';
 if(method==='Workbench.Resources')return {memoryMiB:28672,memoryAuto:!new URLSearchParams(location.search).has('custom'),tempGiB:4,tempAuto:!new URLSearchParams(location.search).has('custom'),timeoutSeconds:300};
 if(method==='Workbench.DiskLimits')return {detected:true,availableGiB:257,reserveGiB:1,maxTempGiB:256,autoTempGiB:64};
 if(method==='Workbench.ResourceLimits')return {physicalMiB:32768,maxMemoryMiB:32768,autoMemoryMiB:8192};
 if(method==='Workbench.Appearance')return 'system';
 if(method==='Workbench.InitialFile')return '';
 if(method==='Workbench.RestoreWorkspaces')return {workspaces:[],warning:''};
 if(method==='Workbench.ListConnections')return [];
 if(method==='Workbench.SetResources')return;
 throw Error(method);
}};
const timer=setInterval(()=>{if(document.body.dataset.ready!=='true')return;clearInterval(timer);
 document.getElementById('settings').click();document.getElementById('settings-tab-performance').click();
 setTimeout(()=>{
 const d=document.getElementById('settings-dialog'),content=document.querySelector('.settings-content'),panel=document.getElementById('settings-panel-performance');
 const input=document.getElementById('query-disk'),range=document.getElementById('query-disk-range'),mode=document.getElementById('query-disk-mode');
 const control=input.closest('.resource-budget-control'),r=control.getBoundingClientRect();
 const save=document.getElementById('save-resources');save.scrollIntoView({block:'nearest'});
 const sr=save.getBoundingClientRect(),dr=d.getBoundingClientRect();
 const reachable=sr.bottom<=dr.bottom&&sr.top>=dr.top;
 content.scrollTop=0;
 const result={panelVisible:!panel.hidden,noOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,rangeFits:range.getBoundingClientRect().left>=r.left&&input.getBoundingClientRect().right<=r.right,reachable,automatic:mode.checked,disabled:input.disabled,max:input.max,value:input.value,summary:document.getElementById('query-disk-summary').textContent};
 const pre=document.createElement('pre');pre.id='visual-result';pre.hidden=true;pre.textContent=JSON.stringify(result);document.body.append(pre);
 },100);
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
        ("settings-light", 1100, 800, "en", False),
        ("settings-dark", 1100, 800, "zh-CN", True),
        ("settings-narrow", 700, 600, "zh-CN", False),
        ("settings-small", 390, 600, "en", False),
    ]:
        with tempfile.TemporaryDirectory(prefix="bamboo-headless-") as profile:
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
