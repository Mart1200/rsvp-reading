CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  password_hash text NOT NULL,
  settings      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Usernames are unique case-insensitively but stored as entered
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE sessions (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE texts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  title       text NOT NULL,
  content     text NOT NULL,
  chapters    jsonb NOT NULL DEFAULT '[]',
  total_words integer NOT NULL,
  -- 'public' is reserved for future sharing; only 'private' is used for now
  visibility  text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX texts_owner_id_idx ON texts (owner_id);

-- Separate from texts so that shared texts can have per-reader progress later
CREATE TABLE progress (
  user_id            uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  text_id            uuid NOT NULL REFERENCES texts ON DELETE CASCADE,
  current_word_index integer NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, text_id)
);
