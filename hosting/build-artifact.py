#!/usr/bin/env python3
"""Build the claude.ai artifact entry page from index.html.
The artifact viewer wraps the page in its own <html>/<head>/<body>, so this strips
those tags, keeps title + stylesheets + scripts, and loads hosting/hosted-shim.js
just before the app starts. Usage: python3 hosting/build-artifact.py <out.html>"""
import re, sys, json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
head = re.search(r'<head>(.*?)</head>', src, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', src, re.S).group(1)
head = re.sub(r'\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>', '', head)
body = body.replace('<script>PCT.app.start();</script>', '<script src="hosting/hosted-shim.js"></script>\n  <script>PCT.app.start();</script>')
# drop modules that do not exist yet (keeps the hosted console clean during staged publishing)
body = re.sub(r'\s*<script src="((?:js|hosting)/[^"]+)"></script>', lambda m: m.group(0) if os.path.exists(os.path.join(root, m.group(1))) else '', body)
out = head.strip() + '\n' + body.strip() + '\n'
dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'hosting', 'artifact.html')
open(dest, 'w', encoding='utf-8').write(out)
files = {}
for path in re.findall(r'(?:src|href)="((?:js|css|hosting)/[^"]+)"', out):
    if os.path.exists(os.path.join(root, path)):
        files[path] = path
print(json.dumps(files, indent=1))
