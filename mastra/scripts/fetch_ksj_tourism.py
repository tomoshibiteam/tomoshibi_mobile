import io
import json
import re
import ssl
import urllib.request
import zipfile
from pathlib import Path

import shapefile  # pyshp

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = "https://nlftp.mlit.go.jp"

context = ssl._create_unverified_context()


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, context=context) as resp:
        return resp.read().decode("utf-8", "ignore")


def fetch_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, context=context) as resp:
        return resp.read()


def extract_zip_paths(html: str, prefix: str):
    pattern = r"DownLd\('([^']*)','([^']*\.zip)','([^']*)'"
    items = re.findall(pattern, html)
    paths = [path for _, _, path in items if f"/ksj/gml/data/{prefix}/" in path]
    return sorted(set(paths))


def read_shapefile_from_zip(data: bytes, shp_hint: str | None = None):
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shp_name = None
        for name in zf.namelist():
            if not name.lower().endswith(".shp"):
                continue
            if shp_hint and shp_hint not in name:
                continue
            shp_name = name
            break
        if not shp_name and shp_hint:
            for name in zf.namelist():
                if name.lower().endswith(".shp"):
                    shp_name = name
                    break
        if not shp_name:
            return None
        base = shp_name[:-4]
        shp = zf.read(base + ".shp")
        shx = zf.read(base + ".shx")
        dbf = zf.read(base + ".dbf")
        reader = shapefile.Reader(
            shp=io.BytesIO(shp), shx=io.BytesIO(shx), dbf=io.BytesIO(dbf), encoding="cp932"
        )
        return reader


def build_feature(name: str, category: str, lat: float, lng: float, extra: dict):
    props = {"name": name, "category": category}
    props.update({k: v for k, v in extra.items() if v})
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": props,
    }


def fetch_p12_tourism():
    html = fetch_text("https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P12-v2_2.html")
    paths = extract_zip_paths(html, "P12")
    features = []
    for path in paths:
        url = BASE_URL + path
        print("[P12] download", url)
        data = fetch_bytes(url)
        reader = read_shapefile_from_zip(data, "TourismResource_Point")
        if reader is None:
            continue
        fields = [f[0] for f in reader.fields[1:]]
        for shape, record in zip(reader.shapes(), reader.records()):
            if shape.shapeType != shapefile.POINT:
                continue
            if not shape.points:
                continue
            lng, lat = shape.points[0]
            row = dict(zip(fields, record))
            name = str(row.get("P12_003", "")).strip()
            if not name:
                continue
            category = str(row.get("P12_004", "")).strip()
            code = str(row.get("P12_002", "")).strip()
            features.append(
                build_feature(
                    name,
                    category,
                    lat,
                    lng,
                    {"code": code, "source": "ksj-p12"},
                )
            )
    out = DATA_DIR / "tourism_ksj.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), encoding="utf-8")
    print("[P12] features", len(features))


def fetch_p33_attractions():
    html = fetch_text("https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P33.html")
    paths = extract_zip_paths(html, "P33")
    features = []
    for path in paths:
        url = BASE_URL + path
        print("[P33] download", url)
        data = fetch_bytes(url)
        reader = read_shapefile_from_zip(data)
        if reader is None:
            continue
        fields = [f[0] for f in reader.fields[1:]]
        for shape, record in zip(reader.shapes(), reader.records()):
            if shape.shapeType != shapefile.POINT:
                continue
            if not shape.points:
                continue
            lng, lat = shape.points[0]
            row = dict(zip(fields, record))
            name = str(row.get("P33_005", "")).strip()
            if not name:
                continue
            category = "集客施設"
            address = str(row.get("P33_007", "")).strip()
            features.append(
                build_feature(
                    name,
                    category,
                    lat,
                    lng,
                    {"address": address, "source": "ksj-p33"},
                )
            )
    out = DATA_DIR / "attractions_ksj.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), encoding="utf-8")
    print("[P33] features", len(features))


if __name__ == "__main__":
    fetch_p12_tourism()
    fetch_p33_attractions()
