"""Verify general-compact layouts in headless Chrome using synthetic IPC data."""

import http.server
import subprocess
import threading
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = root / "artifacts/visual/general-compact"
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
 document.getElementById('settings').click();document.getElementById('settings-tab-performance').click();
 setTimeout(()=>{const d=document.getElementById('settings-dialog'),content=document.querySelector('.settings-content'),close=document.getElementById('settings-dismiss');
 const rect=(n)=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};
 const initial=rect(d),initialClose=rect(close),samples=[];
 for(const tab of ['general','connections','performance','general']){
  document.getElementById('settings-tab-'+tab).click();samples.push({tab,rect:rect(d)});
 }
 const panel=document.getElementById('settings-panel-general');
 const extra=document.createElement('div');extra.style.height='2000px';panel.append(extra);
 const overflow=rect(d);content.scrollTop=content.scrollHeight;const scrolls=content.scrollTop>0;
 const closeStable=JSON.stringify(rect(close))===JSON.stringify(initialClose);
 extra.remove();content.scrollTop=0;
 const title=document.getElementById('appearance-title').getBoundingClientRect(), previews=document.querySelector('.appearance-choices').getBoundingClientRect(), lang=document.getElementById('interface-language').getBoundingClientRect();
 const rowLayout=previews.left>=title.right && Math.abs(previews.right-lang.right)<1 && document.querySelector('.appearance-preview').getBoundingClientRect().width<=92;
 if(!rowLayout)throw Error('General row layout');
 const result={rowLayout,width:innerWidth,lang:document.documentElement.lang,panelVisible:!panel.hidden,dialogOverflow:d.scrollWidth>d.clientWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth,stable:[...samples.map(s=>s.rect),overflow].every(r=>JSON.stringify(r)===JSON.stringify(initial)),closeStable,scrolls,samples};
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
