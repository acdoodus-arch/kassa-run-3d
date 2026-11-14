"""Builds ./netlify-site (static front-end only) for Netlify drag-and-drop or `netlify deploy --dir netlify-site --prod`.
usage: python tools/make_netlify.py https://your-backend.example.com
"""
import os, shutil, sys
backend = (sys.argv[1] if len(sys.argv) > 1 else "").rstrip("/")
if not backend:
    sys.exit("Give the backend URL, e.g.  python tools/make_netlify.py https://kassa-api.ceylongames.com")
out = "netlify-site"
shutil.rmtree(out, ignore_errors=True)
shutil.copytree("static", out, ignore=shutil.ignore_patterns("admin.html"))
open(os.path.join(out, "config.js"), "w").write("window.KASSA_BACKEND = %r;\nwindow.CEYLON_FB = { apiKey: 'AIzaSyD1p-UZ-47ztm7qndWoDlAKW0VcGW2nkHw' };\n" % backend)
open(os.path.join(out, "netlify.toml"), "w").write('[[headers]]\n  for = "/*"\n  [headers.values]\n    Cache-Control = "no-cache"\n    X-Content-Type-Options = "nosniff"\n')
print("built", out, "-> backend", backend)
