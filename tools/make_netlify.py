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
open(os.path.join(out, "netlify.toml"), "w").write(
    '[[headers]]\n  for = "/*"\n  [headers.values]\n    Cache-Control = "no-cache"\n    X-Content-Type-Options = "nosniff"\n'
    # the admin dashboard lives on the game server: proxy /admin and its API through the site
    '[[redirects]]\n  from = "/admin"\n  to = "%s/admin"\n  status = 200\n  force = true\n'
    '[[redirects]]\n  from = "/api/admin/*"\n  to = "%s/api/admin/:splat"\n  status = 200\n  force = true\n' % (backend, backend))
open(os.path.join(out, "_redirects"), "w").write("/admin %s/admin 200!\n/api/admin/* %s/api/admin/:splat 200!\n" % (backend, backend))
print("built", out, "-> backend", backend)
