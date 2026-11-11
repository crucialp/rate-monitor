"""미국 금리(일별)를 FRED(세인트루이스 연준)에서 받아 docs/data/us.csv 로 저장한다.

원자료는 미 연준 H.15(연방기금 목표범위·국채 수익률) — 미국 연방정부 자료(공공영역). 키 없이 받는 CSV 주소를 쓴다.
열: date(YYYYMMDD), fed_lo, fed_hi(연방기금 목표범위 하단·상단), ust2, ust10(미국채 2년·10년, %).
받기에 실패하면 기존 파일을 그대로 둔다(금리 전망 화면이 마지막 정상본을 계속 쓴다).
"""
import csv
import io
import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "us.csv"
START = "2015-01-01"
SERIES = [("fed_lo", "DFEDTARL"), ("fed_hi", "DFEDTARU"), ("ust2", "DGS2"), ("ust10", "DGS10")]


def fetch(sid):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={START}"
    req = urllib.request.Request(url, headers={"User-Agent": "rate-monitor/1.0 (+https://fx-monitor.pages.dev/rates/)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode("utf-8")
    out = {}
    rows = csv.reader(io.StringIO(text))
    head = next(rows)
    if len(head) < 2:
        raise ValueError(f"{sid}: 예상과 다른 머리글 {head}")
    for row in rows:
        if len(row) < 2 or not row[1] or row[1] == ".":
            continue
        out[row[0].replace("-", "")] = float(row[1])
    if len(out) < 100:
        raise ValueError(f"{sid}: 값이 너무 적음 ({len(out)})")
    return out


def main():
    try:
        cols = {k: fetch(sid) for k, sid in SERIES}
    except Exception as e:  # 네트워크·형식 오류: 기존 파일 유지
        print(f"미국 금리 받기 실패, 기존 파일 유지: {e}", file=sys.stderr)
        return
    dates = sorted(set().union(*[set(c) for c in cols.values()]))
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["date"] + [k for k, _ in SERIES])
    for d in dates:
        w.writerow([d] + [("%g" % cols[k][d]) if d in cols[k] else "" for k, _ in SERIES])
    new = buf.getvalue()
    if OUT.exists() and OUT.read_text(encoding="utf-8") == new:
        print("미국 금리 변경 없음")
        return
    OUT.write_text(new, encoding="utf-8")
    print(f"미국 금리 저장: {len(dates)}일, 마지막 {dates[-1]}")


if __name__ == "__main__":
    main()
