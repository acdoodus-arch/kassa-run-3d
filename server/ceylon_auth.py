"""Optional Ceylon Games single sign-on (DISABLED unless CEYLON_FIREBASE_PROJECT is set).

Ceylon My Bus authenticates with Firebase Authentication. To reuse those accounts, the game client signs in
with the same Firebase project, sends the resulting *ID token* to /api/identify as `ceylon_token`, and this
module verifies it (RS256 JWT signed by Google, audience = Firebase project id). Verification needs only the
public project id and Google's public certificates: no secrets, and nothing is written to the bus game's data.

NOT ACTIVE YET: it needs (1) the Firebase project id, (2) the Firebase *web* config on the client, and
(3) your approval. See docs/INTEGRATION.md.
"""
import json, os, time, urllib.request

PROJECT = os.environ.get("CEYLON_FIREBASE_PROJECT", "").strip()
CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
_certs = {"t": 0, "v": {}}


def enabled():
    return bool(PROJECT)


def _get_certs():
    if time.time() - _certs["t"] > 3600:
        with urllib.request.urlopen(CERTS_URL, timeout=5) as r:
            _certs["v"] = json.loads(r.read().decode())
            _certs["t"] = time.time()
    return _certs["v"]


def verify_id_token(token):
    """Returns {'uid','name','picture'} for a valid Firebase ID token, else None."""
    if not enabled():
        return None
    try:
        import jwt  # PyJWT[crypto]
        from cryptography.x509 import load_pem_x509_certificate
        kid = jwt.get_unverified_header(token)["kid"]
        pem = _get_certs()[kid].encode()
        key = load_pem_x509_certificate(pem).public_key()
        claims = jwt.decode(token, key, algorithms=["RS256"], audience=PROJECT,
                            issuer="https://securetoken.google.com/" + PROJECT)
        return {"uid": claims["sub"], "name": claims.get("name") or (claims.get("email") or "").split("@")[0] or "Driver",
                "picture": claims.get("picture", "")}
    except Exception:
        return None
