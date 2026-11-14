"""Build the offline IATA search snapshot from one pinned OurAirports revision (stdlib only)."""
import argparse
import csv
import gzip
import io
import json
import re
from pathlib import Path
from urllib.request import urlopen

DEFAULT_REVISION = "2572ad98ddf81da25b61f91a9e2188d01017c6ea"
ROOT = Path(__file__).resolve().parents[1]
TYPES = {"large_airport": 3, "medium_airport": 2, "small_airport": 1, "heliport": 0, "seaplane_base": 0}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--revision", default=DEFAULT_REVISION)
parser.add_argument("--source-dir", type=Path, help="Read airports.csv, regions.csv and countries.csv from this directory")
args = parser.parse_args()
if not re.fullmatch("[0-9a-f]{40}", args.revision):
    parser.error("Supply a full 40-character Git revision.")


def read_table(name):
    if args.source_dir:
        content = (args.source_dir / (name + ".csv")).read_bytes()
    else:
        url = f"https://raw.githubusercontent.com/davidmegginson/ourairports-data/{args.revision}/{name}.csv"
        with urlopen(url, timeout=45) as response:
            content = response.read()
    return csv.DictReader(io.StringIO(content.decode("utf-8-sig")))


countries = {r["code"]: r["name"] for r in read_table("countries")}
regions = {r["code"]: r["name"] for r in read_table("regions")}
entries = []
for row in read_table("airports"):
    iata = row["iata_code"]
    if not re.fullmatch("[A-Z]{3}", iata) or row["type"] not in TYPES:
        continue
    entries.append([iata, row["name"], row["municipality"], regions.get(row["iso_region"], ""),
                    countries.get(row["iso_country"], ""), row["iso_region"], row["iso_country"],
                    (8 if row["scheduled_service"] == "yes" else 0) + TYPES[row["type"]], row["keywords"]])

entries.sort(key=lambda item: item[0])
if len(entries) < 4000 or len({item[0] for item in entries}) != len(entries):
    raise ValueError("Incomplete or ambiguous IATA snapshot")
path = ROOT / "backend/flights/airports.json.gz"
payload = json.dumps({"revision": args.revision, "airports": entries}, ensure_ascii=False, separators=(",", ":"))
buffer = io.BytesIO()
with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as archive:
    archive.write(payload.encode("utf-8"))
path.with_suffix(".tmp").write_bytes(buffer.getvalue())
path.with_suffix(".tmp").replace(path)
print(f"{len(entries)} airports, {path.stat().st_size} bytes")
