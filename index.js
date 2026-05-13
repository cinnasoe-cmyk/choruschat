const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 20185;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret-key";

const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new sqlite3.Database(path.join(DATA_DIR, "chat.sqlite"));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '/default-avatar.svg',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_user_id, to_user_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL,
    user_b INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_a, user_b)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY(chat_id, user_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    edited_at DATETIME
  )`);

  await run(`CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id, emoji)
  )`);
}

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
});

app.use(express.json());
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

io.engine.use(sessionMiddleware);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `avatar-${req.session.user.id}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only images are allowed."));
    cb(null, true);
  }
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in." });
  next();
}

function cleanUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "")
    .slice(0, 20);
}

function cleanText(text, max = 2000) {
  return String(text || "").trim().slice(0, max);
}

async function publicUser(userId) {
  return await get(
    `SELECT id, username, display_name, bio, avatar_url FROM users WHERE id = ?`,
    [userId]
  );
}

async function areFriends(a, b) {
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  const row = await get(`SELECT id FROM friendships WHERE user_a = ? AND user_b = ?`, [x, y]);
  return !!row;
}

async function userCanAccessChat(userId, chatId) {
  const row = await get(`SELECT 1 FROM chat_members WHERE user_id = ? AND chat_id = ?`, [userId, chatId]);
  return !!row;
}

async function emitChats(userId) {
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  for (const s of sockets) {
    s.emit("chats:update");
    s.emit("friends:update");
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});



function normalizeMeteredDomain(value) {
  if (!value) return "";
  return String(value)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.metered\.live$/i, "");
}

let cachedTurnCredential = null;
let cachedTurnCredentialExpiresAt = 0;

function buildMeteredIceServers(username, credential) {
  return [
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username,
      credential
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username,
      credential
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username,
      credential
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username,
      credential
    }
  ];
}

function summarizeIceServers(iceServers) {
  return (iceServers || []).map((server) => ({
    urls: server.urls,
    hasUsername: Boolean(server.username),
    hasCredential: Boolean(server.credential),
    isTurn: JSON.stringify(server.urls || "").includes("turn:")
  }));
}

app.get("/api/ice-servers", async (req, res) => {
  const fallback = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" }
  ];

  try {
    const meteredDomain = normalizeMeteredDomain(process.env.METERED_DOMAIN);
    const meteredApiKey = process.env.METERED_API_KEY || process.env.TURN_API_KEY;
    const meteredSecretKey = process.env.METERED_SECRET_KEY || process.env.METERED_SECRET || process.env.TURN_SECRET_KEY;
    const directUsername = process.env.METERED_USERNAME || process.env.TURN_USERNAME;
    const directCredential = process.env.METERED_CREDENTIAL || process.env.METERED_PASSWORD || process.env.TURN_PASSWORD || process.env.TURN_CREDENTIAL;

    // Easiest/manual mode: paste username/password from "Show ICE Servers Array" into Railway.
    if (directUsername && directCredential) {
      const iceServers = buildMeteredIceServers(directUsername, directCredential);
      return res.json({
        iceServers,
        source: "metered-direct-username-password",
        hasTurn: true
      });
    }

    // API key mode: use the API key from a generated TURN credential.
    if (meteredDomain && meteredApiKey) {
      const response = await fetch(`https://${meteredDomain}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Metered TURN apiKey request failed: ${response.status} ${text}`);
      }

      const iceServers = await response.json();

      if (Array.isArray(iceServers) && iceServers.length) {
        return res.json({
          iceServers,
          source: "metered-api-key",
          hasTurn: iceServers.some((s) => JSON.stringify(s.urls || "").includes("turn:"))
        });
      }
    }

    // Secret key mode: create a temporary TURN credential on the backend, cache it, then return safe ICE servers.
    if (meteredDomain && meteredSecretKey) {
      const now = Date.now();

      if (!cachedTurnCredential || now > cachedTurnCredentialExpiresAt) {
        const createResponse = await fetch(`https://${meteredDomain}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(meteredSecretKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: "chorus-auto-turn",
            expiryInSeconds: 86400
          })
        });

        if (!createResponse.ok) {
          const text = await createResponse.text();
          throw new Error(`Metered TURN secretKey create failed: ${createResponse.status} ${text}`);
        }

        cachedTurnCredential = await createResponse.json();
        cachedTurnCredentialExpiresAt = now + (23 * 60 * 60 * 1000);
      }

      if (cachedTurnCredential?.username && cachedTurnCredential?.password) {
        const iceServers = buildMeteredIceServers(cachedTurnCredential.username, cachedTurnCredential.password);
        return res.json({
          iceServers,
          source: "metered-secret-key-auto-created",
          hasTurn: true
        });
      }
    }

    return res.json({
      iceServers: fallback,
      source: "stun-only-no-turn-variables",
      hasTurn: false
    });
  } catch (err) {
    console.error("/api/ice-servers error:", err);
    return res.status(500).json({
      iceServers: fallback,
      source: "stun-only-error",
      hasTurn: false,
      error: err.message
    });
  }
});

app.get("/api/ice-debug", async (req, res) => {
  const meteredDomain = normalizeMeteredDomain(process.env.METERED_DOMAIN);
  const hasApiKey = Boolean(process.env.METERED_API_KEY || process.env.TURN_API_KEY);
  const hasSecretKey = Boolean(process.env.METERED_SECRET_KEY || process.env.METERED_SECRET || process.env.TURN_SECRET_KEY);
  const hasDirectUsername = Boolean(process.env.METERED_USERNAME || process.env.TURN_USERNAME);
  const hasDirectCredential = Boolean(process.env.METERED_CREDENTIAL || process.env.METERED_PASSWORD || process.env.TURN_PASSWORD || process.env.TURN_CREDENTIAL);

  try {
    const result = await new Promise((resolve) => {
      const fakeReq = {};
      const fakeRes = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          resolve({ statusCode: this.statusCode, data });
        }
      };

      const iceHandler = app._router.stack.find((layer) => layer.route && layer.route.path === "/api/ice-servers")?.route?.stack?.[0]?.handle;
      if (iceHandler) iceHandler(fakeReq, fakeRes);
      else resolve({ statusCode: 500, data: { error: "ice handler not found" } });
    });

    res.json({
      meteredDomain,
      hasApiKey,
      hasSecretKey,
      hasDirectUsername,
      hasDirectCredential,
      source: result.data.source,
      hasTurn: result.data.hasTurn,
      error: result.data.error || null,
      iceServers: summarizeIceServers(result.data.iceServers)
    });
  } catch (err) {
    res.status(500).json({
      meteredDomain,
      hasApiKey,
      hasSecretKey,
      hasDirectUsername,
      hasDirectCredential,
      error: err.message
    });
  }
});




app.get("/api/me", async (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const user = await publicUser(req.session.user.id);
  res.json({ user });
});

app.post("/api/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");
    const displayName = cleanText(req.body.displayName || username, 30);

    if (username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    const existing = await get(`SELECT id FROM users WHERE username = ?`, [username]);
    if (existing) return res.status(400).json({ error: "That username is already claimed." });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO users (username, password_hash, display_name, bio, avatar_url) VALUES (?, ?, ?, ?, ?)`,
      [username, passwordHash, displayName, "", "/default-avatar.svg"]
    );

    req.session.user = { id: result.lastID, username };
    res.json({ user: await publicUser(result.lastID) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Register failed." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");
    const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);

    if (!user) return res.status(400).json({ error: "Wrong username or password." });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: "Wrong username or password." });

    req.session.user = { id: user.id, username: user.username };
    res.json({ user: await publicUser(user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.patch("/api/profile", requireAuth, async (req, res) => {
  const displayName = cleanText(req.body.displayName, 30) || req.session.user.username;
  const bio = cleanText(req.body.bio, 160);
  await run(`UPDATE users SET display_name = ?, bio = ? WHERE id = ?`, [displayName, bio, req.session.user.id]);
  res.json({ user: await publicUser(req.session.user.id) });
});

app.post("/api/profile/avatar", requireAuth, upload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No avatar uploaded." });
  const avatarUrl = `/uploads/${req.file.filename}`;
  await run(`UPDATE users SET avatar_url = ? WHERE id = ?`, [avatarUrl, req.session.user.id]);
  res.json({ user: await publicUser(req.session.user.id) });
});

app.get("/api/search-users", requireAuth, async (req, res) => {
  const q = cleanUsername(req.query.q);
  if (!q) return res.json({ users: [] });

  const users = await all(
    `SELECT id, username, display_name, bio, avatar_url
     FROM users
     WHERE username LIKE ? AND id != ?
     LIMIT 10`,
    [`%${q}%`, req.session.user.id]
  );

  res.json({ users });
});

app.post("/api/friend-requests", requireAuth, async (req, res) => {
  const toUsername = cleanUsername(req.body.username);
  const target = await get(`SELECT id FROM users WHERE username = ?`, [toUsername]);

  if (!target) return res.status(404).json({ error: "User not found." });
  if (target.id === req.session.user.id) return res.status(400).json({ error: "You cannot add yourself." });
  if (await areFriends(req.session.user.id, target.id)) return res.status(400).json({ error: "You are already friends." });

  try {
    await run(
      `INSERT OR IGNORE INTO friend_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'pending')`,
      [req.session.user.id, target.id]
    );

    io.to(`user:${target.id}`).emit("friends:update");
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Friend request already sent." });
  }
});

app.get("/api/friends", requireAuth, async (req, res) => {
  const userId = req.session.user.id;

  const friends = await all(
    `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
     WHERE f.user_a = ? OR f.user_b = ?
     ORDER BY u.display_name`,
    [userId, userId, userId]
  );

  const incoming = await all(
    `SELECT fr.id, u.id AS user_id, u.username, u.display_name, u.bio, u.avatar_url
     FROM friend_requests fr
     JOIN users u ON u.id = fr.from_user_id
     WHERE fr.to_user_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`,
    [userId]
  );

  const outgoing = await all(
    `SELECT fr.id, u.id AS user_id, u.username, u.display_name, u.bio, u.avatar_url
     FROM friend_requests fr
     JOIN users u ON u.id = fr.to_user_id
     WHERE fr.from_user_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`,
    [userId]
  );

  res.json({ friends, incoming, outgoing });
});

app.post("/api/friend-requests/:id/accept", requireAuth, async (req, res) => {
  const requestId = Number(req.params.id);
  const fr = await get(
    `SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`,
    [requestId, req.session.user.id]
  );

  if (!fr) return res.status(404).json({ error: "Request not found." });

  const a = Math.min(fr.from_user_id, fr.to_user_id);
  const b = Math.max(fr.from_user_id, fr.to_user_id);

  await run(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`, [requestId]);
  await run(`INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)`, [a, b]);

  await emitChats(fr.from_user_id);
  await emitChats(fr.to_user_id);

  res.json({ ok: true });
});

app.post("/api/friend-requests/:id/decline", requireAuth, async (req, res) => {
  const requestId = Number(req.params.id);
  await run(
    `UPDATE friend_requests SET status = 'declined' WHERE id = ? AND to_user_id = ?`,
    [requestId, req.session.user.id]
  );
  res.json({ ok: true });
});

app.get("/api/chats", requireAuth, async (req, res) => {
  const userId = req.session.user.id;

  const chats = await all(
    `SELECT c.id, c.type, c.name, c.created_at
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     WHERE cm.user_id = ?
     ORDER BY c.created_at DESC`,
    [userId]
  );

  for (const chat of chats) {
    chat.members = await all(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url
       FROM chat_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.chat_id = ?
       ORDER BY u.display_name`,
      [chat.id]
    );

    if (chat.type === "dm") {
      const other = chat.members.find(m => m.id !== userId);
      chat.name = other ? other.display_name : "Deleted User";
      chat.avatar_url = other ? other.avatar_url : "/default-avatar.svg";
    }
  }

  res.json({ chats });
});

app.post("/api/chats/dm", requireAuth, async (req, res) => {
  const otherId = Number(req.body.userId);
  if (!otherId || otherId === req.session.user.id) return res.status(400).json({ error: "Invalid user." });
  if (!(await areFriends(req.session.user.id, otherId))) return res.status(403).json({ error: "You must be friends first." });

  const existing = await get(
    `SELECT c.id
     FROM chats c
     JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
     JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
     WHERE c.type = 'dm'
     LIMIT 1`,
    [req.session.user.id, otherId]
  );

  if (existing) return res.json({ chatId: existing.id });

  const result = await run(`INSERT INTO chats (type, name, created_by) VALUES ('dm', NULL, ?)`, [req.session.user.id]);
  await run(`INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)`, [result.lastID, req.session.user.id]);
  await run(`INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)`, [result.lastID, otherId]);

  await emitChats(req.session.user.id);
  await emitChats(otherId);

  res.json({ chatId: result.lastID });
});

app.post("/api/chats/group", requireAuth, async (req, res) => {
  const name = cleanText(req.body.name, 40) || "New Group";
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(Number) : [];
  const uniqueIds = [...new Set(memberIds.filter(id => id && id !== req.session.user.id))];

  if (uniqueIds.length < 1) return res.status(400).json({ error: "Add at least one friend." });

  for (const id of uniqueIds) {
    if (!(await areFriends(req.session.user.id, id))) {
      return res.status(403).json({ error: "You can only add friends to groups." });
    }
  }

  const result = await run(`INSERT INTO chats (type, name, created_by) VALUES ('group', ?, ?)`, [name, req.session.user.id]);
  await run(`INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)`, [result.lastID, req.session.user.id]);

  for (const id of uniqueIds) {
    await run(`INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)`, [result.lastID, id]);
  }

  for (const id of [req.session.user.id, ...uniqueIds]) {
    await emitChats(id);
  }

  res.json({ chatId: result.lastID });
});

app.get("/api/chats/:chatId/messages", requireAuth, async (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!(await userCanAccessChat(req.session.user.id, chatId))) return res.status(403).json({ error: "No access." });

  const messages = await all(
    `SELECT m.id, m.chat_id, m.sender_id, m.body, m.is_deleted, m.created_at, m.edited_at,
            u.username, u.display_name, u.avatar_url, u.bio
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.chat_id = ?
     ORDER BY m.id ASC
     LIMIT 200`,
    [chatId]
  );

  for (const msg of messages) {
    msg.reactions = await all(
      `SELECT r.emoji, COUNT(*) AS count
       FROM reactions r
       WHERE r.message_id = ?
       GROUP BY r.emoji
       ORDER BY r.emoji`,
      [msg.id]
    );
  }

  res.json({ messages });
});

app.delete("/api/chats/:chatId", requireAuth, async (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!(await userCanAccessChat(req.session.user.id, chatId))) return res.status(403).json({ error: "No access." });

  // This removes the chat for everyone in this starter version.
  // For a production app, you would usually hide it per-user instead.
  const members = await all(`SELECT user_id FROM chat_members WHERE chat_id = ?`, [chatId]);

  await run(`DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE chat_id = ?)`, [chatId]);
  await run(`DELETE FROM messages WHERE chat_id = ?`, [chatId]);
  await run(`DELETE FROM chat_members WHERE chat_id = ?`, [chatId]);
  await run(`DELETE FROM chats WHERE id = ?`, [chatId]);

  for (const member of members) await emitChats(member.user_id);

  res.json({ ok: true });
});

io.on("connection", async (socket) => {
  const sessionUser = socket.request.session.user;

  if (!sessionUser) {
    socket.emit("auth:error", "Not logged in.");
    socket.disconnect();
    return;
  }

  socket.join(`user:${sessionUser.id}`);

  const chats = await all(
    `SELECT chat_id FROM chat_members WHERE user_id = ?`,
    [sessionUser.id]
  );

  for (const chat of chats) socket.join(`chat:${chat.chat_id}`);

  socket.on("join chat", async (chatId) => {
    chatId = Number(chatId);
    if (await userCanAccessChat(sessionUser.id, chatId)) {
      socket.join(`chat:${chatId}`);
    }
  });




  // ─── PURE RELAY CALL SIGNALING ─────────────────────────────
  // WebRTC-free call signaling. This powers the incoming call popup
  // and accept/decline flow for Socket.IO relayed audio.
  socket.on("voice:call", async (data) => {
    try {
      const chatId = Number(data.chatId);
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;

      const caller = await publicUser(sessionUser.id);
      const members = await all(
        `SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?`,
        [chatId, sessionUser.id]
      );

      for (const member of members) {
        io.to(`user:${member.user_id}`).emit("voice:incoming", {
          chatId,
          fromUserId: sessionUser.id,
          fromUser: caller
        });
      }

      console.log(`Relay voice call from user ${sessionUser.id} to chat ${chatId}`);
    } catch (err) {
      console.error("voice:call error:", err);
    }
  });

  socket.on("voice:accept", async (data) => {
    try {
      const chatId = Number(data.chatId);
      const toUserId = Number(data.toUserId);

      if (!toUserId) return;
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;
      if (!(await userCanAccessChat(toUserId, chatId))) return;

      const accepter = await publicUser(sessionUser.id);

      io.to(`user:${toUserId}`).emit("voice:accepted", {
        chatId,
        fromUserId: sessionUser.id,
        fromUser: accepter
      });

      console.log(`Relay voice accepted by user ${sessionUser.id} to user ${toUserId} chat ${chatId}`);
    } catch (err) {
      console.error("voice:accept error:", err);
    }
  });

  socket.on("voice:decline", async (data) => {
    try {
      const chatId = Number(data.chatId);
      const toUserId = Number(data.toUserId);

      if (!toUserId) return;
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;
      if (!(await userCanAccessChat(toUserId, chatId))) return;

      io.to(`user:${toUserId}`).emit("voice:declined", {
        chatId,
        fromUserId: sessionUser.id
      });

      console.log(`Relay voice declined by user ${sessionUser.id} to user ${toUserId} chat ${chatId}`);
    } catch (err) {
      console.error("voice:decline error:", err);
    }
  });


  // ─── RELAY AUDIO CALLS ─────────────────────────────
  // This is a non-WebRTC fallback. Audio is captured in small Opus/WebM chunks
  // and relayed through Socket.IO. It works on hosts/networks where WebRTC fails.
  socket.on("voice:join", async (data) => {
    try {
      const chatId = Number(data.chatId);
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;

      socket.join(`voice:${chatId}`);
      const caller = await publicUser(sessionUser.id);

      socket.to(`voice:${chatId}`).emit("voice:joined", {
        chatId,
        user: caller
      });

      console.log(`Voice relay join user ${sessionUser.id} chat ${chatId}`);
    } catch (err) {
      console.error("voice:join error:", err);
    }
  });

  socket.on("voice:chunk", async (data) => {
    try {
      const chatId = Number(data.chatId);
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;
      if (!data.chunk) return;

      socket.to(`voice:${chatId}`).emit("voice:chunk", {
        chatId,
        fromUserId: sessionUser.id,
        chunk: data.chunk,
        mimeType: data.mimeType || "audio/webm"
      });
    } catch (err) {
      console.error("voice:chunk error:", err);
    }
  });

  socket.on("voice:leave", async (data) => {
    try {
      const chatId = Number(data.chatId);
      if (!chatId) return;

      socket.leave(`voice:${chatId}`);
      socket.to(`voice:${chatId}`).emit("voice:left", {
        chatId,
        fromUserId: sessionUser.id
      });

      console.log(`Voice relay leave user ${sessionUser.id} chat ${chatId}`);
    } catch (err) {
      console.error("voice:leave error:", err);
    }
  });


  // ─── WEBRTC CALL SIGNALING ─────────────────────────────
  // These events are required so the other user's browser actually receives
  // the incoming call popup, WebRTC offer, answer, and ICE candidates.
  socket.on("call:invite", async (data) => {
    try {
      const chatId = Number(data.chatId);
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;

      const caller = await publicUser(sessionUser.id);
      const members = await all(
        `SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?`,
        [chatId, sessionUser.id]
      );

      for (const member of members) {
        io.to(`user:${member.user_id}`).emit("call:incoming", {
          chatId,
          fromUserId: sessionUser.id,
          fromUser: caller,
          callType: data.callType || "audio"
        });
      }

      console.log(`Call invite from user ${sessionUser.id} to chat ${chatId}`);
    } catch (err) {
      console.error("call:invite error:", err);
    }
  });

  socket.on("call:offer", async (data) => {
    try {
      const chatId = Number(data.chatId);
      const toUserId = Number(data.toUserId);

      if (!toUserId) return;
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;
      if (!(await userCanAccessChat(toUserId, chatId))) return;

      const caller = await publicUser(sessionUser.id);

      io.to(`user:${toUserId}`).emit("call:offer", {
        chatId,
        fromUserId: sessionUser.id,
        fromUser: caller,
        offer: data.offer,
        callType: data.callType || "audio"
      });

      console.log(`Call offer from user ${sessionUser.id} to user ${toUserId} in chat ${chatId}`);
    } catch (err) {
      console.error("call:offer error:", err);
    }
  });

  socket.on("call:answer", async (data) => {
    try {
      const chatId = Number(data.chatId);
      const toUserId = Number(data.toUserId);

      if (!toUserId) return;
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;
      if (!(await userCanAccessChat(toUserId, chatId))) return;

      io.to(`user:${toUserId}`).emit("call:answer", {
        chatId,
        fromUserId: sessionUser.id,
        answer: data.answer
      });

      console.log(`Call answer from user ${sessionUser.id} to user ${toUserId} in chat ${chatId}`);
    } catch (err) {
      console.error("call:answer error:", err);
    }
  });

  socket.on("call:ice", async (data) => {
    try {
      const chatId = Number(data.chatId);
      const toUserId = Number(data.toUserId);

      if (!toUserId || !data.candidate) return;
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;
      if (!(await userCanAccessChat(toUserId, chatId))) return;

      io.to(`user:${toUserId}`).emit("call:ice", {
        chatId,
        fromUserId: sessionUser.id,
        candidate: data.candidate
      });
    } catch (err) {
      console.error("call:ice error:", err);
    }
  });

  socket.on("call:end", async (data) => {
    try {
      const chatId = Number(data.chatId);
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;

      const members = await all(
        `SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?`,
        [chatId, sessionUser.id]
      );

      for (const member of members) {
        io.to(`user:${member.user_id}`).emit("call:end", {
          chatId,
          fromUserId: sessionUser.id
        });
      }

      console.log(`Call ended by user ${sessionUser.id} in chat ${chatId}`);
    } catch (err) {
      console.error("call:end error:", err);
    }
  });

  socket.on("call:decline", async (data) => {
    try {
      const chatId = Number(data.chatId);
      const toUserId = Number(data.toUserId);

      if (!toUserId) return;
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;
      if (!(await userCanAccessChat(toUserId, chatId))) return;

      io.to(`user:${toUserId}`).emit("call:declined", {
        chatId,
        fromUserId: sessionUser.id
      });

      console.log(`Call declined by user ${sessionUser.id} to user ${toUserId} in chat ${chatId}`);
    } catch (err) {
      console.error("call:decline error:", err);
    }
  });

  socket.on("message:send", async (data) => {
    try {
      const chatId = Number(data.chatId);
      const body = cleanText(data.body, 2000);
      if (!body) return;
      if (!(await userCanAccessChat(sessionUser.id, chatId))) return;

      const result = await run(
        `INSERT INTO messages (chat_id, sender_id, body) VALUES (?, ?, ?)`,
        [chatId, sessionUser.id, body]
      );

      const msg = await get(
        `SELECT m.id, m.chat_id, m.sender_id, m.body, m.is_deleted, m.created_at, m.edited_at,
                u.username, u.display_name, u.avatar_url, u.bio
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.id = ?`,
        [result.lastID]
      );
      msg.reactions = [];

      io.to(`chat:${chatId}`).emit("message:new", msg);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("message:edit", async (data) => {
    try {
      const messageId = Number(data.messageId);
      const body = cleanText(data.body, 2000);
      if (!body) return;

      const msg = await get(`SELECT * FROM messages WHERE id = ?`, [messageId]);
      if (!msg || msg.sender_id !== sessionUser.id) return;
      if (!(await userCanAccessChat(sessionUser.id, msg.chat_id))) return;

      await run(`UPDATE messages SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?`, [body, messageId]);

      io.to(`chat:${msg.chat_id}`).emit("message:edited", {
        id: messageId,
        body,
        edited_at: new Date().toISOString()
      });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("message:delete", async (data) => {
    try {
      const messageId = Number(data.messageId);
      const msg = await get(`SELECT * FROM messages WHERE id = ?`, [messageId]);

      if (!msg || msg.sender_id !== sessionUser.id) return;
      if (!(await userCanAccessChat(sessionUser.id, msg.chat_id))) return;

      await run(`UPDATE messages SET is_deleted = 1, body = 'Message deleted' WHERE id = ?`, [messageId]);

      io.to(`chat:${msg.chat_id}`).emit("message:deleted", {
        id: messageId,
        body: "Message deleted"
      });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("message:react", async (data) => {
    try {
      const messageId = Number(data.messageId);
      const emoji = cleanText(data.emoji, 8);
      if (!emoji) return;

      const msg = await get(`SELECT * FROM messages WHERE id = ?`, [messageId]);
      if (!msg) return;
      if (!(await userCanAccessChat(sessionUser.id, msg.chat_id))) return;

      const existing = await get(
        `SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`,
        [messageId, sessionUser.id, emoji]
      );

      if (existing) {
        await run(`DELETE FROM reactions WHERE id = ?`, [existing.id]);
      } else {
        await run(
          `INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)`,
          [messageId, sessionUser.id, emoji]
        );
      }

      const reactions = await all(
        `SELECT emoji, COUNT(*) AS count FROM reactions WHERE message_id = ? GROUP BY emoji ORDER BY emoji`,
        [messageId]
      );

      io.to(`chat:${msg.chat_id}`).emit("message:reactions", {
        id: messageId,
        reactions
      });
    } catch (err) {
      console.error(err);
    }
  });
});

initDb().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`chorus running on port ${PORT}`);
  });
});
