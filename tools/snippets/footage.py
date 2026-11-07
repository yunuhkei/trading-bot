"""Free, licensed footage for snippet videos.
- Mixkit: only clips under the Mixkit Stock Video Free License (commercial/promo use OK, no attribution); clips marked
  "Restricted" are skipped.
- Internet Archive Prelinger collection: public-domain vintage films (for the VHS / old-film look).
Every clip's source, id, page and license are saved next to it (provenance.json).
Usage: python -I footage.py <out_dir> mixkit|prelinger <keyword> <count>"""
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; snippet-maker)"}


def get(url, binary=False, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def mixkit(out, keyword, n):
    page = get(f"https://mixkit.co/free-stock-video/{urllib.parse.quote(keyword.replace(' ', '-'))}/")
    items = list(dict.fromkeys(re.findall(r'href="(/free-stock-video/[a-z0-9-]+-(\d+)/)"', page)))
    got = []
    for path, vid in items:
        if len(got) >= n:
            break
        try:
            item = get("https://mixkit.co" + path)
        except Exception:
            continue
        if 'data-license="videoFree"' not in item or re.search(r'"name":"[^"]*Restricted License"', item):
            continue                                   # only the free license
        links = sorted(set(re.findall(r'https://assets\.mixkit\.co/[^"\s]*\.mp4', item)))
        best = [u for u in links if "-720" in u] or [u for u in links if "-1080" in u]
        if not best:
            continue
        url = best[0]
        dest = os.path.join(out, f"mixkit_{vid}.mp4")
        try:
            if not os.path.exists(dest) or os.path.getsize(dest) < 100_000:
                data = get(url, binary=True, timeout=120)
                if len(data) < 100_000:
                    continue
                open(dest, "wb").write(data)
        except Exception:
            continue
        got.append({"file": dest, "source": "mixkit", "id": vid, "page": "https://mixkit.co" + path, "url": url,
                    "license": "Mixkit Stock Video Free License (https://mixkit.co/license/#videoFree)"})
        time.sleep(0.5)
    return got


def prelinger(out, keyword, n):
    q = urllib.parse.quote(f"collection:prelinger AND ({keyword})")
    res = json.loads(get(f"https://archive.org/advancedsearch.php?q={q}&fl%5B%5D=identifier&rows=60&output=json"))
    ids = [d["identifier"] for d in res["response"]["docs"]]
    random.Random(keyword).shuffle(ids)
    got = []
    for ident in ids:
        if len(got) >= n:
            break
        try:
            meta = json.loads(get(f"https://archive.org/metadata/{ident}"))
        except Exception:
            continue
        files = [f for f in meta.get("files", []) if f.get("name", "").endswith(".mp4")]
        files.sort(key=lambda f: int(f.get("size") or 1e12))
        small = [f for f in files if 2e6 < int(f.get("size") or 0) < 60e6]
        if not small:
            continue
        f = small[0]
        url = f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}"
        dest = os.path.join(out, f"prelinger_{ident}.mp4")
        try:
            if not os.path.exists(dest):
                open(dest, "wb").write(get(url, binary=True, timeout=300))
        except Exception:
            continue
        got.append({"file": dest, "source": "prelinger", "id": ident, "page": f"https://archive.org/details/{ident}",
                    "url": url, "license": (meta.get("metadata") or {}).get("licenseurl") or "Prelinger Archives: public domain"})
    return got


if __name__ == "__main__":
    out, src, kw, n = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    os.makedirs(out, exist_ok=True)
    got = (mixkit if src == "mixkit" else prelinger)(out, kw, n)
    prov = os.path.join(out, "provenance.json")
    old = json.load(open(prov)) if os.path.exists(prov) else []
    json.dump(old + [g for g in got if g["file"] not in {o["file"] for o in old}], open(prov, "w"), indent=1)
    print(f"{src} '{kw}': {len(got)} clips")
