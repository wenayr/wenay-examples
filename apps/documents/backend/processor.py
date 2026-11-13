"""Bounded CSV service: private input path, one JSON response, parent owns lifetime."""
import csv
import io
import json
import pathlib
import sys
import time

try:
    source = pathlib.Path(sys.argv[1])
    if source.stat().st_size > 512 * 1024:
        raise ValueError('size')
    text = source.read_text(encoding='utf-8-sig')
    rows = list(csv.reader(io.StringIO(text, newline=''), strict=True))
    rows = [row for row in rows if any(row)]
    headers = rows.pop(0) if rows else []
    if not 1 <= len(headers) <= 20 or len(rows) > 200:
        raise ValueError('dimensions')
    if any(len(value) > 120 or not value.strip() for value in headers) or len(set(headers)) != len(headers):
        raise ValueError('headers')
    if any(len(row) != len(headers) or any(len(value) > 1000 for value in row) for row in rows):
        raise ValueError('cells')
    print(json.dumps({'headers': headers, 'rows': rows}, ensure_ascii=True), flush=True)
except Exception:
    print(json.dumps({'error': 'CSV parsing failed'}), flush=True)

# createProcessResource models a service. Its parent closes it after readiness;
# input/output data never becomes a shell command or process argument.
time.sleep(60)
