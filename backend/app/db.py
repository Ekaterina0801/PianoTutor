import os, sqlite3, uuid, datetime
from pathlib import Path
from app.security import hash_password

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")

def _path() -> Path:
    if not DATABASE_URL.startswith("sqlite:///"):
        raise RuntimeError("Only sqlite supported in scaffold")
    return Path(DATABASE_URL.replace("sqlite:///", "", 1)).resolve()

def connect() -> sqlite3.Connection:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def _has_column(cur: sqlite3.Cursor, table: str, column: str) -> bool:
    rows = cur.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)

def _add_column(cur: sqlite3.Cursor, table: str, column: str, ddl: str) -> None:
    if not _has_column(cur, table, column):
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

def _seed_user(cur: sqlite3.Cursor, email: str, name: str, role: str) -> None:
    found = cur.execute("SELECT id FROM users WHERE lower(email)=lower(?)", (email,)).fetchone()
    if found:
        return
    cur.execute(
        """
        INSERT INTO users (id,email,name,role,password_hash,is_active,created_at)
        VALUES (?,?,?,?,?,?,?)
        """,
        (
            str(uuid.uuid4()),
            email,
            name,
            role,
            hash_password(os.getenv("DEMO_PASSWORD", "demo1234")),
            1,
            datetime.datetime.utcnow().isoformat() + "Z",
        ),
    )

def init_db():
    conn = connect()
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','teacher','researcher','admin')),
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      exercise_id TEXT,
      created_at TEXT,
      source TEXT,
      metrics_json TEXT,
      events_json TEXT,
      pipeline_json TEXT,
      research_json TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)
    _add_column(cur, "sessions", "pipeline_json", "TEXT")
    _add_column(cur, "sessions", "research_json", "TEXT")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      config_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      artifacts_json TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      note TEXT,
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      FOREIGN KEY(teacher_id) REFERENCES users(id),
      FOREIGN KEY(student_id) REFERENCES users(id)
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      PRIMARY KEY(user_id, key),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)
    _seed_user(cur, "student@piano.local", "Демо студент", "student")
    _seed_user(cur, "teacher@piano.local", "Демо преподаватель", "teacher")
    _seed_user(cur, "researcher@piano.local", "Демо исследователь", "researcher")
    _seed_user(cur, "admin@piano.local", "Демо администратор", "admin")
    conn.commit()
    conn.close()
