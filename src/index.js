import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
import fs from 'node:fs';
import path from 'node:path';

const { Client, LocalAuth, MessageMedia } = pkg;
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('BOT_TOKEN is missing.'); process.exit(1); }

const DATA_DIR = path.resolve('data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SESSION_DIR = path.join(DATA_DIR, 'wa-session');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

const defaults = {
  autoReply: false, delayMs: 10000, text: '', image: null, voice: null,
  file: null, adminChatId: null, activeAccountId: null, accounts: []
};
function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...defaults, ...raw, accounts: Array.isArray(raw.accounts) ? raw.accounts : [] };
  } catch { return { ...defaults }; }
}
let settings = loadSettings();
const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const pending = new Map();
const accounts = new Map();
let accountCounter = 0;

function keyboard() {
  const rows = [
    [{ text: '📱 Add WhatsApp' }, { text: '🚪 Logout WhatsApp' }],
    [{ text: '📋 Accounts' }, { text: '🤖 Auto Reply' }],
    [{ text: '✍️ Set Text' }, { text: '🖼️ Set Image' }],
    [{ text: '🎙️ Set Voice' }, { text: '📎 Set File' }],
    [{ text: '📊 Status' }]
  ];
  for (let i = 0; i < settings.accounts.length; i += 2) {
    rows.push(settings.accounts.slice(i, i + 2).map(a => ({ text: `📱 ${a.name}` })));
  }
  return { reply_markup: { keyboard: rows, resize_keyboard: true } };
}
function statusText() {
  const out = [
    'WhatsApp Auto Reply Bot', '',
    `Auto Reply: ${settings.autoReply ? '🟢 ON' : '🔴 OFF'}`,
    `Delay: ${Number(settings.delayMs) / 1000}s`,
    `Text: ${settings.text ? '✅' : '❌'}`,
    `Image: ${settings.image ? '✅' : '❌'}`,
    `Voice: ${settings.voice ? '✅' : '❌'}`,
    `File: ${settings.file ? '✅' : '❌'}`, '', 'Accounts:'
  ];
  if (!settings.accounts.length) out.push('❌ No accounts added.');
  for (const a of settings.accounts) {
    const s = accounts.get(a.id);
    out.push(`${a.name}: ${s?.ready ? '🟢 Connected' : s?.initializing ? '🟡 Starting' : '🔴 Offline'}${settings.activeAccountId === a.id ? ' ⭐' : ''}`);
  }
  return out.join('\n');
}
function activeAccount() {
  if (settings.activeAccountId && accounts.has(settings.activeAccountId)) return accounts.get(settings.activeAccountId);
  for (const a of settings.accounts) if (accounts.has(a.id)) {
    settings.activeAccountId = a.id; saveSettings(); return accounts.get(a.id);
  }
  return null;
}

async function sendQr(state, qr) {
  if (state.qrBusy || !settings.adminChatId) return;
  state.qrBusy = true;
  try {
    const data = await QRCode.toDataURL(qr, { margin: 1, width: 700 });
    await bot.sendPhoto(settings.adminChatId, Buffer.from(data.split(',')[1], 'base64'), { caption: `📱 Scan QR to connect ${state.name}.` });
  } catch (e) { console.error('QR error:', e?.message || e); }
  finally { setTimeout(() => { state.qrBusy = false; }, 3000); }
}

async function sendConfiguredReply(state, msg) {
  if (!settings.autoReply) return;
  if (!settings.text && !settings.image && !settings.voice && !settings.file) return;
  const delay = Number(settings.delayMs);
  if (Number.isFinite(delay) && delay > 0) await new Promise(r => setTimeout(r, delay));

  // ALL configured items are sent, in this order: text -> image -> voice -> file.
  if (settings.text) await msg.reply(settings.text);
  if (settings.image && fs.existsSync(settings.image)) {
    await msg.reply(MessageMedia.fromFilePath(settings.image));
  }
  if (settings.voice && fs.existsSync(settings.voice)) {
    await msg.reply(MessageMedia.fromFilePath(settings.voice), undefined, { sendAudioAsVoice: true });
  }
  if (settings.file && fs.existsSync(settings.file)) {
    await msg.reply(MessageMedia.fromFilePath(settings.file));
  }
}

function createAccount(id, name) {
  const state = { id, name, client: null, ready: false, initializing: false, initialized: false, qrBusy: false, destroyed: false, messageCounts: new Map() };
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id, dataPath: SESSION_DIR }),
    puppeteer: {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      headless: true, protocolTimeout: 120000,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--no-first-run','--no-zygote']
    }
  });
  state.client = client;
  client.on('qr', qr => sendQr(state, qr));
  client.on('authenticated', () => console.log(`WhatsApp authenticated: ${name}`));
  client.on('ready', async () => {
    state.ready = true; state.initializing = false; state.initialized = true;
    console.log(`WhatsApp READY: ${name}`);
    if (settings.adminChatId) await bot.sendMessage(settings.adminChatId, `✅ ${name} connected successfully.`, keyboard()).catch(() => {});
  });
  client.on('auth_failure', e => { state.ready = false; state.initializing = false; console.error(`Auth failure (${name}):`, e); });
  client.on('disconnected', r => { state.ready = false; state.initializing = false; state.initialized = false; console.log(`Disconnected (${name}):`, r); });

  client.on('message', async msg => {
    if (!settings.autoReply || msg.fromMe || msg.isStatus || !state.ready) return;
    const from = msg.from;
    const count = (state.messageCounts.get(from) || 0) + 1;
    state.messageCounts.set(from, count);
    if (count !== 1) return;
    try { await sendConfiguredReply(state, msg); }
    catch (e) { console.error(`Auto-reply error (${name}):`, e?.message || e); }
  });
  accounts.set(id, state);
  return state;
}
async function initializeAccount(state) {
  if (!state || state.destroyed || state.ready || state.initializing || state.initialized) return;
  state.initializing = true;
  try { console.log(`Starting WhatsApp account: ${state.name}`); await state.client.initialize(); state.initialized = true; }
  catch (e) { state.initialized = false; console.error(`Initialize error (${state.name}):`, e?.message || e); }
  finally { state.initializing = false; }
}
function nextId() {
  do { accountCounter++; } while (settings.accounts.some(a => a.id === `account-${accountCounter}`));
  return `account-${accountCounter}`;
}
async function addAccount(chatId) {
  const id = nextId(); const name = `WhatsApp ${settings.accounts.length + 1}`;
  settings.accounts.push({ id, name }); settings.activeAccountId = id; settings.adminChatId = chatId; saveSettings();
  const state = createAccount(id, name);
  await bot.sendMessage(chatId, `⏳ Starting ${name}...\nQR code will be sent here when ready.`, keyboard());
  initializeAccount(state);
}
async function logoutAccount(state) {
  if (!state) return { message: '❌ No WhatsApp account selected.' };
  state.destroyed = true;
  try { if (state.ready) await state.client.logout(); } catch {}
  try { await state.client.destroy(); } catch {}
  accounts.delete(state.id);
  settings.accounts = settings.accounts.filter(a => a.id !== state.id);
  if (settings.activeAccountId === state.id) settings.activeAccountId = settings.accounts.at(-1)?.id || null;
  saveSettings();
  try { fs.rmSync(path.join(SESSION_DIR, `session-${state.id}`), { recursive: true, force: true }); } catch {}
  return { message: `✅ ${state.name} logged out and removed.` };
}
function setPending(chatId, type) { pending.set(chatId, type); }

bot.onText(/^\/start$/, async msg => {
  settings.adminChatId = msg.chat.id; saveSettings();
  await bot.sendMessage(msg.chat.id, statusText(), keyboard());
});

bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const waiting = pending.get(chatId);
  settings.adminChatId = chatId;

  if (waiting === 'image' && msg.photo?.length) {
    try {
      const fileId = msg.photo.at(-1).file_id;
      const downloaded = await bot.downloadFile(fileId, MEDIA_DIR);
      const dest = path.join(MEDIA_DIR, 'reply-image.jpg');
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(downloaded, dest); settings.image = dest; pending.delete(chatId); saveSettings();
      return bot.sendMessage(chatId, '✅ Image saved.', keyboard());
    } catch (e) { console.error(e); return bot.sendMessage(chatId, '❌ Image save failed.', keyboard()); }
  }
  if (waiting === 'voice' && (msg.voice || msg.audio)) {
    try {
      const fileId = msg.voice?.file_id || msg.audio?.file_id;
      const downloaded = await bot.downloadFile(fileId, MEDIA_DIR);
      const ext = path.extname(downloaded) || '.ogg';
      const dest = path.join(MEDIA_DIR, `reply-voice${ext}`);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(downloaded, dest); settings.voice = dest; pending.delete(chatId); saveSettings();
      return bot.sendMessage(chatId, '✅ Voice saved.', keyboard());
    } catch (e) { console.error(e); return bot.sendMessage(chatId, '❌ Voice save failed.', keyboard()); }
  }
  if (waiting === 'file' && msg.document) {
    try {
      const fileId = msg.document.file_id;
      const downloaded = await bot.downloadFile(fileId, MEDIA_DIR);
      const safe = path.basename(msg.document.file_name || path.basename(downloaded));
      const dest = path.join(MEDIA_DIR, `reply-file-${safe}`);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(downloaded, dest); settings.file = dest; pending.delete(chatId); saveSettings();
      return bot.sendMessage(chatId, '✅ File saved.', keyboard());
    } catch (e) { console.error(e); return bot.sendMessage(chatId, '❌ File save failed.', keyboard()); }
  }

  // Keep this AFTER image/voice/file handlers. This is the important media fix.
  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;

  if (waiting === 'text') {
    settings.text = msg.text; pending.delete(chatId); saveSettings();
    return bot.sendMessage(chatId, '✅ Auto-reply text saved.', keyboard());
  }
  if (msg.text === '📱 Add WhatsApp') return addAccount(chatId);
  if (msg.text === '🚪 Logout WhatsApp') {
    const result = await logoutAccount(activeAccount());
    return bot.sendMessage(chatId, result.message, keyboard());
  }
  if (msg.text === '📋 Accounts') return bot.sendMessage(chatId, statusText(), keyboard());

  const selected = settings.accounts.find(a => msg.text === `📱 ${a.name}`);
  if (selected) {
    settings.activeAccountId = selected.id; saveSettings();
    return bot.sendMessage(chatId, `✅ Active account: ${selected.name}`, keyboard());
  }
  if (msg.text === '🤖 Auto Reply') {
    settings.autoReply = !settings.autoReply; saveSettings();
    return bot.sendMessage(chatId, `Auto Reply: ${settings.autoReply ? '🟢 ON' : '🔴 OFF'}\n\nFirst incoming message gets Text + Image + Voice + File (if set).`, keyboard());
  }
  if (msg.text === '✍️ Set Text') { setPending(chatId, 'text'); return bot.sendMessage(chatId, 'Send the auto-reply text.', keyboard()); }
  if (msg.text === '🖼️ Set Image') { setPending(chatId, 'image'); return bot.sendMessage(chatId, 'Send the image.', keyboard()); }
  if (msg.text === '🎙️ Set Voice') { setPending(chatId, 'voice'); return bot.sendMessage(chatId, 'Send the voice/audio.', keyboard()); }
  if (msg.text === '📎 Set File') { setPending(chatId, 'file'); return bot.sendMessage(chatId, 'Send the document/file.', keyboard()); }
  if (msg.text === '📊 Status') return bot.sendMessage(chatId, statusText(), keyboard());
});

for (const meta of settings.accounts) {
  const m = String(meta.id).match(/^account-(\d+)$/);
  if (m) accountCounter = Math.max(accountCounter, Number(m[1]));
  const state = createAccount(meta.id, meta.name);
  await new Promise(r => setTimeout(r, 1000));
  initializeAccount(state);
}

console.log('Telegram bot started.');
console.log('Waiting for Telegram /start...');
bot.on('polling_error', e => console.error('Telegram polling error:', e?.message || e));
