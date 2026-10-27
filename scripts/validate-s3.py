#!/usr/bin/env python3
"""Native AWS S3 UI/IPC acceptance using synthetic S3 transport, never user secrets."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/s3'
OUT.mkdir(parents=True,exist_ok=True)
ENV={**os.environ,'GOTOOLCHAIN':'go1.27.3'}
binary=ROOT/'build/bamboo-s3-validation'
subprocess.run(['go','build','-tags=r2smoke','-ldflags=-s -w','-o',str(binary),'.'],cwd=ROOT,env=ENV,check=True)
reports={}
with tempfile.TemporaryDirectory(prefix='bamboo-s3-validation-') as config:
 for phase,count in [('s3',24),('s3-restore',5)]:
  destination=OUT/phase
  destination.mkdir(parents=True,exist_ok=True)
  report_file=destination/'desktop-smoke.json'
  report_file.unlink(missing_ok=True)
  env={**ENV,'BAMBOO_CONFIG_DIR':config,'BAMBOO_R2_FIXTURES':str(ROOT/'build/coverage-fixtures'),'BAMBOO_SMOKE':str(destination),'BAMBOO_WORKSPACE_SMOKE':phase}
  result=subprocess.run([str(binary)],cwd=ROOT,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
  (destination/'process.log').write_text(result.stdout)
  result.check_returncode()
  report=json.loads(report_file.read_text())
  assert not report.get('error') and len(report['result']['checks'])==count,report
  assert not report['narrowLayout']['overflow'] and report['narrowFooterReachable'],report
  reports[phase]=report
  print(f'{phase}: {count} real desktop checks passed',flush=True)
(OUT/'native-summary.json').write_text(json.dumps({'fixture':'local S3 protocol / synthetic credentials; live AWS account not tested','checks':sum(len(r['result']['checks']) for r in reports.values()),'testBinarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest()},indent=2)+'\n')
images=[]
for name,label in [('bamboo-light','S3 工作区查询'),('bamboo-desktop','深色界面'),('bamboo-s3-connection','连接表单')]:
 p=OUT/'s3'/(name+'.png')
 images.append(f'<figure><img alt="{label}" src="data:image/png;base64,{base64.b64encode(p.read_bytes()).decode()}"><figcaption>{label}</figcaption></figure>')
(OUT/'S3-validation.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bamboo S3 验证</title><style>body{font:16px/1.6 system-ui;max-width:1000px;margin:32px auto;padding:0 20px;color:#17212e;background:#f9fafb}h1{font-size:28px}img{width:100%;height:auto;border:1px solid #ddd;border-radius:8px}figure{margin:24px 0}figcaption{color:#556;margin-top:8px}strong{color:#1e73ba}</style><h1>Bamboo · S3 工作区</h1><p><strong>29 项真实桌面检查通过</strong>：连接、工作区查询、跨文件 JOIN、分页、精确数值、重启恢复和关闭行为。</p><p>截图来自真实桌面窗口。远程读写协议使用本机 S3 测试服务和合成凭据；实际 AWS S3 存储桶仍需在应用内配置后验收。</p>'+''.join(images)+'</html>')
