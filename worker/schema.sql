-- 방문 기록(관리자 화면 /admin 용). 페이지를 처음 열 때 한 줄씩 남긴다.
-- 적용: npx wrangler d1 execute rate-monitor-visits --remote --file worker/schema.sql
CREATE TABLE IF NOT EXISTS visits (
  id      INTEGER PRIMARY KEY,
  ts      INTEGER NOT NULL,   -- 밀리초(UTC)
  ip      TEXT,
  country TEXT,
  city    TEXT,
  org     TEXT,               -- 통신사·기관(AS 이름)
  ua      TEXT,
  bot     INTEGER NOT NULL DEFAULT 0,
  host    TEXT,
  query   TEXT,
  referer TEXT
);
CREATE INDEX IF NOT EXISTS visits_ts ON visits(ts);
CREATE INDEX IF NOT EXISTS visits_ip ON visits(ip);
