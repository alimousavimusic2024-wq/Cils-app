CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  first_name TEXT,
  level TEXT CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
  questions_used_today INTEGER NOT NULL DEFAULT 0,
  last_question_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
  grammar_topic TEXT NOT NULL,
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  question TEXT NOT NULL,
  option_a TEXT NOT NULL, option_b TEXT NOT NULL, option_c TEXT NOT NULL, option_d TEXT NOT NULL,
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A','B','C','D')),
  explanation TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level);
CREATE TABLE IF NOT EXISTS exam_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  exam_date TEXT NOT NULL,
  level TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  UNIQUE (user_id, exam_date)
);
CREATE TABLE IF NOT EXISTS exam_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exam_sessions(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
  UNIQUE (exam_id, position),
  UNIQUE (exam_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_eq_question ON exam_questions(question_id);
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exam_sessions(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  selected TEXT NOT NULL CHECK (selected IN ('A','B','C','D')),
  UNIQUE (exam_id, question_id)
);
