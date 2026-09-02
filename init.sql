CREATE TABLE IF NOT EXISTS health_check (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL
);

INSERT INTO health_check (message)
VALUES ('database is working')
ON CONFLICT DO NOTHING;