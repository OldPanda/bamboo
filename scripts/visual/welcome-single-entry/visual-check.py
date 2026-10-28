"""Verify welcome-single-entry layouts in headless Chrome using synthetic IPC data."""

import http.server
import subprocess
import tempfile
import threading
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = root / "artifacts/visual/welcome-single-entry"
out.mkdir(parents=True, exist_ok=True)
mock = """globalThis.mygo={on:()=>()=>{},call:async(method,...args)=>{
 if(method==='Workbench.Language')return new URLSearchParams(location.search).get('lang')||'en';
 if(method==='Workbench.Resources')return {memoryMiB:28672,memoryAuto:!new URLSearchParams(location.search).has('custom'),tempGiB:4,timeoutSeconds:300};
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

 const launcher=document.getElementById('welcome-data'), sidebar=document.getElementById('open-data');
 if(sidebar.getClientRects().length!==0)throw Error('Duplicate welcome launcher');
 launcher.click();
 if(!document.getElementById('source-dialog').open)throw Error('Missing source chooser');
 document.getElementById('source-dismiss').click();
 const zone=document.getElementById('welcome-drop-zone');
 const r=zone.getBoundingClientRect();
 const drag=(x,y)=>zone.dispatchEvent(new DragEvent('dragover',{bubbles:true,clientX:x,clientY:y,dataTransfer:Object.assign(new DataTransfer(),{})}));
 const fire=(x,y)=>{const dt=new DataTransfer();dt.items.add(new File(['x'],'example.parquet'));zone.dispatchEvent(new DragEvent('dragover',{bubbles:true,clientX:x,clientY:y,dataTransfer:dt}));};
 const before=getComputedStyle(zone).backgroundColor;
 fire(r.x-10,r.y);const outside=!zone.classList.contains('drag-active');
 fire(r.x+r.width/2,r.y+r.height/2);const inside=zone.classList.contains('drag-active');
 setTimeout(()=>{
 if(document.activeElement!==launcher)throw Error('Focus not restored');
 const changed=getComputedStyle(zone).backgroundColor!==before;
 if(!new URLSearchParams(location.search).has('active'))zone.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
 const result={outside,inside,changed,width:innerWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth,rect:[r.x,r.y,r.width,r.height],text:document.getElementById('welcome-drop-title').textContent};
 const pre=document.createElement('pre');pre.id='visual-result';pre.hidden=true;pre.textContent=JSON.stringify(result);document.body.append(pre);
 },200);
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
        ("welcome-light", 1100, 800, "en", False),
        ("welcome-dark-active", 1100, 800, "zh-CN", True),
        ("welcome-small", 390, 600, "en", False),
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
