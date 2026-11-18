CREATE TABLE IF NOT EXISTS shared_schedules (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  sessions_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shared_directory (
  department TEXT NOT NULL,
  position TEXT NOT NULL,
  person TEXT NOT NULL,
  PRIMARY KEY (department, position, person)
) WITHOUT ROWID;
