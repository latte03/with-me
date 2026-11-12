package server

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	disabled INTEGER NOT NULL DEFAULT 0,
	quota_bytes INTEGER NOT NULL DEFAULT 5368709120,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id),
	name TEXT NOT NULL DEFAULT '',
	fingerprint TEXT NOT NULL DEFAULT '',
	revoked INTEGER NOT NULL DEFAULT 0,
	last_seq INTEGER NOT NULL DEFAULT 0,
	last_seen TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	device_id TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ops (
	cursor INTEGER PRIMARY KEY AUTOINCREMENT,
	op_id TEXT NOT NULL UNIQUE,
	user_id TEXT NOT NULL,
	device_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	type TEXT NOT NULL,
	payload TEXT NOT NULL,
	client_created_at TEXT NOT NULL,
	accepted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ops_user_cursor ON ops(user_id, cursor);
CREATE TABLE IF NOT EXISTS roles (
	user_id TEXT NOT NULL,
	id TEXT NOT NULL,
	name TEXT NOT NULL DEFAULT '',
	avatar TEXT NOT NULL DEFAULT '',
	color TEXT NOT NULL DEFAULT '',
	kind TEXT NOT NULL DEFAULT '',
	pinned INTEGER NOT NULL DEFAULT 0,
	hidden INTEGER NOT NULL DEFAULT 0,
	deleted INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL DEFAULT '',
	version INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS messages (
	user_id TEXT NOT NULL,
	id TEXT NOT NULL,
	role_id TEXT NOT NULL DEFAULT '',
	type TEXT NOT NULL DEFAULT 'text',
	text TEXT NOT NULL DEFAULT '',
	todo_done INTEGER NOT NULL DEFAULT 0,
	attachment_ref TEXT NOT NULL DEFAULT '',
	meta TEXT NOT NULL DEFAULT '',
	side TEXT NOT NULL DEFAULT 'right',
	deleted INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL DEFAULT '',
	version INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS attachments (
	user_id TEXT NOT NULL,
	hash TEXT NOT NULL,
	size INTEGER NOT NULL,
	mime TEXT NOT NULL,
	kind TEXT NOT NULL,
	thumb_hash TEXT NOT NULL DEFAULT '',
	blob_path TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (user_id, hash)
);
-- clips: 剪藏去重投影（platform + note_id -> message_id），非事实来源。
CREATE TABLE IF NOT EXISTS clips (
	user_id TEXT NOT NULL,
	platform TEXT NOT NULL,
	note_id TEXT NOT NULL,
	message_id TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (user_id, platform, note_id)
);
CREATE INDEX IF NOT EXISTS clips_message ON clips(user_id, message_id);
`

const ftsSchema = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
	INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
	INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
`

func OpenDB(dataDir string) (*sql.DB, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.ToSlash(filepath.Join(dataDir, "withme.db")) +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// single conn avoids SQLITE_BUSY between the writer and readers
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	// Additive migrations for existing databases (CREATE TABLE IF NOT EXISTS does not add columns).
	if err := ensureColumn(db, "messages", "meta", "TEXT NOT NULL DEFAULT ''"); err != nil {
		db.Close()
		return nil, err
	}
	if err := ensureColumn(db, "roles", "kind", "TEXT NOT NULL DEFAULT ''"); err != nil {
		db.Close()
		return nil, err
	}
	if err := ensureColumn(db, "devices", "fingerprint", "TEXT NOT NULL DEFAULT ''"); err != nil {
		db.Close()
		return nil, err
	}
	mergeLegacyDevices(db)
	backfillClips(db)
	return db, nil
}

func ensureColumn(db *sql.DB, table, column, decl string) error {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + decl)
	return err
}

// mergeLegacyDevices 归并旧客户端重复创建的设备行：那时设备身份只存在浏览器存储里，
// 存储一换就多一行。只处理没有指纹的历史行，按 (user_id, name) 保留最近活跃的一行，
// 会话迁到保留行上，历史 ops 的 device_id 原样留档。
func mergeLegacyDevices(db *sql.DB) {
	rows, err := db.Query(`SELECT user_id, name FROM devices WHERE fingerprint = '' GROUP BY user_id, name HAVING COUNT(*) > 1`)
	if err != nil {
		return
	}
	type group struct{ userID, name string }
	var groups []group
	for rows.Next() {
		var g group
		if rows.Scan(&g.userID, &g.name) == nil {
			groups = append(groups, g)
		}
	}
	rows.Close()
	for _, g := range groups {
		var keep string
		if db.QueryRow(`SELECT id FROM devices WHERE user_id = ? AND name = ? AND fingerprint = ''
			ORDER BY last_seen DESC, last_seq DESC, rowid DESC LIMIT 1`, g.userID, g.name).Scan(&keep) != nil {
			continue
		}
		losers, err := db.Query(`SELECT id, last_seq FROM devices WHERE user_id = ? AND name = ? AND fingerprint = '' AND id <> ?`,
			g.userID, g.name, keep)
		if err != nil {
			continue
		}
		type loser struct {
			id  string
			seq int64
		}
		var dropped []loser
		for losers.Next() {
			var l loser
			if losers.Scan(&l.id, &l.seq) == nil {
				dropped = append(dropped, l)
			}
		}
		losers.Close()
		for _, l := range dropped {
			db.Exec(`UPDATE sessions SET device_id = ? WHERE device_id = ?`, keep, l.id)
			db.Exec(`UPDATE devices SET last_seq = MAX(last_seq, ?) WHERE id = ?`, l.seq, keep)
			db.Exec(`DELETE FROM devices WHERE id = ?`, l.id)
		}
	}
}

// backfillClips rebuilds the clips projection from clip message metadata.
func backfillClips(db *sql.DB) {
	rows, err := db.Query(`SELECT user_id, id, meta FROM messages WHERE type = 'clip' AND meta != '' AND deleted = 0`)
	if err != nil {
		return
	}
	type row struct{ userID, messageID, meta string }
	var all []row
	for rows.Next() {
		var r row
		if rows.Scan(&r.userID, &r.messageID, &r.meta) == nil {
			all = append(all, r)
		}
	}
	rows.Close()
	for _, r := range all {
		var m struct {
			Platform string `json:"platform"`
			NoteID   string `json:"note_id"`
		}
		if json.Unmarshal([]byte(r.meta), &m) != nil || m.Platform == "" || m.NoteID == "" {
			continue
		}
		db.Exec(`INSERT INTO clips(user_id, platform, note_id, message_id, updated_at)
			VALUES(?,?,?,?,?) ON CONFLICT(user_id, platform, note_id)
			DO UPDATE SET message_id=excluded.message_id, updated_at=excluded.updated_at`,
			r.userID, m.Platform, m.NoteID, r.messageID, nowUTC())
	}
}
