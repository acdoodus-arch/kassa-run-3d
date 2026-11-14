#!/usr/bin/env sh
python3 -m pip install -q -r requirements.txt
exec python3 server/app.py
