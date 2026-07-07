/**
 * database.js
 *
 * sql.js is a pure WebAssembly port of SQLite. It requires zero native
 * compilation and works on Windows, Linux, and macOS without any build tools.
 *
 * sql.js loads the entire database into memory. To persist data to disk we
 * save the database file after every write operation. This thin wrapper
 * exposes the same prepare/run/get/all API that better-sqlite3 uses, so
 * the rest of the codebase does not need to change.
 *
 * Emscripten / WebAssembly initialization in Node.js is asynchronous, so we
 * initialize it in the background and assign it to rawDb once resolved.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'spendwise.db');

let rawDb = null;

function save() {
  if (!rawDb) return;
  const data = rawDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Initialize sql.js asynchronously
initSqlJs().then(SQL => {
  const fileExists = fs.existsSync(DB_PATH);
  if (fileExists) {
    try {
      const buf = fs.readFileSync(DB_PATH);
      rawDb = new SQL.Database(buf);
    } catch (e) {
      console.error("Failed to load existing database file, creating fresh:", e);
      rawDb = new SQL.Database();
    }
  } else {
    rawDb = new SQL.Database();
  }

  // Create tables if they don't exist
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      monthly_limit REAL NOT NULL,
      month TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, category, month)
    )
  `);

  save();
  console.log("Database initialized successfully.");
}).catch(err => {
  console.error("Database initialization failed:", err);
});

// ─── Compatibility layer ────────────────────────────────────────────────────
//
// Translates the better-sqlite3 style (prepare / run / get / all / lastInsertRowid)
// into sql.js calls so all route files work without any changes.

const db = {
  prepare(sql) {
    return {
      // Run an INSERT / UPDATE / DELETE — returns { lastInsertRowid, changes }
      run(...params) {
        if (!rawDb) throw new Error("Database is still initializing. Please try again in a moment.");
        rawDb.run(sql, params);
        const idRow = rawDb.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = idRow[0] ? idRow[0].values[0][0] : null;
        save();
        return { lastInsertRowid, changes: rawDb.getRowsModified() };
      },

      // Return a single row as a plain object, or undefined if not found
      get(...params) {
        if (!rawDb) throw new Error("Database is still initializing. Please try again in a moment.");
        const stmt = rawDb.prepare(sql);
        stmt.bind(params);
        if (!stmt.step()) {
          stmt.free();
          return undefined;
        }
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        stmt.free();
        const obj = {};
        cols.forEach((c, i) => { obj[c] = vals[i]; });
        return obj;
      },

      // Return all matching rows as an array of plain objects
      all(...params) {
        if (!rawDb) throw new Error("Database is still initializing. Please try again in a moment.");
        const result = rawDb.exec(sql, params);
        if (!result.length) return [];
        const { columns, values } = result[0];
        return values.map(row => {
          const obj = {};
          columns.forEach((c, i) => { obj[c] = row[i]; });
          return obj;
        });
      }
    };
  }
};
db.exec(`
  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    monthly_limit REAL NOT NULL,
    month TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, category, month)
  );
`);
module.exports = db;
