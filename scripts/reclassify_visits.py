"""방문 기록(D1 visits)의 봇 여부를 현재 규칙으로 다시 매긴다.

규칙은 worker/src/admin.js 의 isBot 과 같게 유지한다.
사용:
  npx wrangler d1 execute rate-monitor-visits --remote --json --command "SELECT id, ua, org FROM visits" > rows.json
  python scripts/reclassify_visits.py rows.json > fix.sql
  npx wrangler d1 execute rate-monitor-visits --remote --file fix.sql
"""
import json
import re
import sys

BOT_UA = re.compile(r"bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|discord|slack|telegram|whatsapp|headless|curl|wget|python|go-http|java/|okhttp|axios|node-fetch|monitor|uptime|measurement|checker|discovery|enricher|research|scanner|httpx|zgrab|masscan|nmap|nuclei", re.I)
FAKE_UA = re.compile(r"^Mozilla/5\.0 \([^)]*\) Chrome/[\d.]+$")
DATACENTER = re.compile(r"amazon|google|microsoft|azure|ovh|hetzner|digitalocean|scaleway|linode|akamai|vultr|choopa|oracle|alibaba|tencent|huawei cloud|contabo|leaseweb|m247|driftnet|techoff|virtualine|egihosting|interserver|datacamp|cdn77|hostinger|ionos|netcup|colocrossing|psychz|quadranet|tc datacenter|techties|code200|cloudflare|fastly|wgix|ipxo|aeza|stark industries|zenlayer|gcore|g-core|constant company|data ?center|hosting|server|vps|cloud|naukowa|badawczy|research|^us isp$", re.I)


def is_bot(ua: str, org: str) -> bool:
    if not ua or BOT_UA.search(ua) or FAKE_UA.search(ua):
        return True
    if re.search(r"\(compatible;", ua, re.I) and not re.search(r"MSIE|Trident", ua):
        return True
    return bool(org) and bool(DATACENTER.search(org))


def main() -> None:
    rows = json.load(open(sys.argv[1], encoding="utf-8"))[0]["results"]
    bots = [r["id"] for r in rows if is_bot(r.get("ua") or "", r.get("org") or "")]
    humans = [r["id"] for r in rows if r["id"] not in set(bots)]
    for flag, ids in ((1, bots), (0, humans)):
        for i in range(0, len(ids), 500):
            chunk = ",".join(str(x) for x in ids[i:i + 500])
            print(f"UPDATE visits SET bot = {flag} WHERE id IN ({chunk});")
    print(f"-- bots {len(bots)}, humans {len(humans)}", file=sys.stderr)


if __name__ == "__main__":
    main()
