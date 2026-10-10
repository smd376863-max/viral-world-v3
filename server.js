require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
const CHANNEL_ID = String(process.env.TELEGRAM_CHANNEL_ID || "");
const CHANNEL_USERNAME = (process.env.TELEGRAM_CHANNEL_USERNAME || "").replace(/^@/, "");
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_USER_ID || "");
const ALLOW_DEV_NO_INITDATA = process.env.ALLOW_DEV_NO_INITDATA === "true";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "posts.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

function readPosts() {
  try { const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); return Array.isArray(data) ? data : []; }
  catch (e) { console.error("Could not read posts store:", e.message); return []; }
}
function writePosts(posts) {
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(posts, null, 2), "utf8");
  fs.renameSync(temp, DATA_FILE);
}
function upsertPost(post) {
  const posts = readPosts();
  const index = posts.findIndex(p => String(p.telegramMessageId) === String(post.telegramMessageId) && String(p.chatId) === String(post.chatId));
  if (index >= 0) posts[index] = { ...posts[index], ...post };
  else posts.unshift(post);
  writePosts(posts.slice(0, 500));
}
function extractText(message) {
  return String(message.text || message.caption || "").trim();
}
function extractImage(message) {
  if (message.photo && message.photo.length) {
    const photo = message.photo[message.photo.length - 1];
    return { fileId: photo.file_id, fileUniqueId: photo.file_unique_id };
  }
  if (message.video && message.video.thumbnail) {
    return { fileId: message.video.thumbnail.file_id, fileUniqueId: message.video.thumbnail.file_unique_id };
  }
  return null;
}
function getMessageLink(message, chat) {
  if (chat.username) return `https://t.me/${chat.username}/${message.message_id}`;
  // Private channel posts generally use /c/<internal-id>/<message-id>.
  const raw = String(chat.id);
  if (raw.startsWith("-100")) return `https://t.me/c/${raw.slice(4)}/${message.message_id}`;
  return "";
}
function onChannelPost(message) {
  const chat = message.chat || {};
  if (CHANNEL_ID && String(chat.id) !== CHANNEL_ID) {
    console.log("Ignoring channel post from unconfigured chat", chat.id);
    return;
  }
  const text = extractText(message);
  const photo = extractImage(message);
  const video = message.video || null;
  const link = getMessageLink(message, chat);
  if (!text && !photo && !video) return;
  upsertPost({
    id: `${chat.id}_${message.message_id}`,
    chatId: String(chat.id),
    telegramMessageId: message.message_id,
    title: text ? text.slice(0, 240) : (video ? "Telegram ভিডিও" : "Telegram পোস্ট"),
    text,
    url: link,
    category: "Telegram",
    date: new Date((message.date || Math.floor(Date.now()/1000)) * 1000).toISOString(),
    imageFileId: photo ? photo.fileId : null,
    videoFileId: video ? video.file_id : null,
    hasVideo: Boolean(video),
    hasPhoto: Boolean(photo)
  });
}

function validateInitData(initData) {
  if (!TOKEN) return { ok: false, reason: "Bot token is not configured" };
  if (!initData || typeof initData !== "string") return { ok: false, reason: "Missing Telegram initData" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "Missing hash" };
  params.delete("hash");
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const a = Buffer.from(expectedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "Invalid initData signature" };
  const authDate = Number(params.get("auth_date") || 0);
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!authDate || age < -60 || age > 86400) return { ok: false, reason: "Expired initData" };
  let user = null;
  try { user = JSON.parse(params.get("user") || "null"); } catch (_) {}
  return { ok: true, user, authDate };
}
function requireTelegramUser(req, res, next) {
  const initData = req.get("x-telegram-init-data") || "";
  if (!initData && ALLOW_DEV_NO_INITDATA && process.env.NODE_ENV !== "production") {
    req.telegramUser = { id: 0, first_name: "Local developer" };
    return next();
  }
  const result = validateInitData(initData);
  if (!result.ok) return res.status(401).json({ ok: false, error: "Telegram session validation failed", detail: result.reason });
  req.telegramUser = result.user;
  next();
}
function requireAdmin(req, res, next) {
  if (!ADMIN_ID) return res.status(503).json({ ok: false, error: "ADMIN_TELEGRAM_USER_ID is not configured" });
  if (!req.telegramUser || String(req.telegramUser.id) !== ADMIN_ID) return res.status(403).json({ ok: false, error: "Admin only" });
  next();
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "Viral World V3", time: new Date().toISOString() }));
app.get("/api/config", (_req, res) => res.json({
  appName: "Viral World",
  channelUrl: CHANNEL_USERNAME ? `https://t.me/${CHANNEL_USERNAME}` : "",
  botUrl: BOT_USERNAME ? `https://t.me/${BOT_USERNAME}` : "",
  telegramConfigured: Boolean(TOKEN && WEBHOOK_SECRET && CHANNEL_ID)
}));
app.get("/api/posts", (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
  const posts = readPosts().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, posts });
});
app.get("/api/telegram-file/:fileId", async (req, res) => {
  // Telegram file URLs contain the bot token. Keep this proxy server-side.
  if (!TOKEN) return res.status(503).json({ error: "Bot token not configured" });
  const fileId = req.params.fileId;
  try {
    const api = await fetch(`https://api.telegram.org/bot${TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const json = await api.json();
    if (!json.ok || !json.result || !json.result.file_path) return res.status(404).json({ error: "Telegram file not found" });
    const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${json.result.file_path}`;
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) return res.status(502).json({ error: "Could not fetch Telegram file" });
    res.set("Content-Type", fileResponse.headers.get("content-type") || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=3600");
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    res.send(buffer);
  } catch (e) { res.status(502).json({ error: "Telegram file proxy failed" }); }
});
app.post("/api/telegram/webhook", (req, res) => {
  const receivedSecret = req.get("x-telegram-bot-api-secret-token") || "";
  if (!WEBHOOK_SECRET || receivedSecret !== WEBHOOK_SECRET) return res.status(403).json({ ok: false });
  const update = req.body || {};
  if (update.channel_post) onChannelPost(update.channel_post);
  if (update.edited_channel_post) onChannelPost(update.edited_channel_post);
  // Acknowledge quickly; Telegram will retry if a webhook response is not 2xx.
  res.json({ ok: true });
});
app.get("/api/me", requireTelegramUser, (req, res) => res.json({ ok: true, user: req.telegramUser || null }));
app.post("/api/admin/post", requireTelegramUser, requireAdmin, (req, res) => {
  const { title, url, category = "Other" } = req.body || {};
  if (!title || !url || !/^https:\/\/t\.me\//i.test(url)) return res.status(400).json({ ok: false, error: "title and a Telegram t.me URL are required" });
  const post = { id: `manual_${Date.now()}`, chatId: "manual", telegramMessageId: Date.now(), title: String(title).slice(0,240), text: String(title), url, category: String(category).slice(0,40), date: new Date().toISOString(), imageFileId: null, videoFileId: null, hasVideo: false, hasPhoto: false };
  upsertPost(post);
  res.json({ ok: true, post });
});
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`Viral World V3 listening on port ${PORT}`);
  if (!TOKEN) console.warn("Set TELEGRAM_BOT_TOKEN in .env before using Telegram integration.");
});
