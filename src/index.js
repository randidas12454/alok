import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
import fs from 'node:fs';
import path from 'node:path';

const { Client, LocalAuth, MessageMedia } = pkg;

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing. Add it in Railway Variables.');
  process.exit(1);
}

const DATA_DIR = path.resolve('data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const defaults = {
  autoReply: false,
  delayMs: 10000,
  text: 'Hello! Thanks for your message. We will reply soon.',
  image: null,
  voice: null,
  file: null,
  adminChatId: null
};

function loadSettings() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...defaults };
  }
}
let settings = loadSettings();

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const keyboard = {
  reply_markup: {
    keyboard: [
      [{ text: '📱 Add WhatsApp' }, { text: '🤖 Auto Reply' }],
      [{ text: '✍️ Set Text' }, { text: '🖼️ Set Image' }],
      [{ text: '🎙️ Set Voice' }, { text: '📎 Set File' }],
      [{ text: '🔄 Reply 2' }, { text: '📊 Status' }]
    ],
    resize_keyboard: true
  }
};

function statusText() {
  return `WhatsApp Auto Reply Bot

Auto Reply: ${settings.autoReply ? '🟢 ON' : '🔴 OFF'}
Delay: ${settings.delayMs / 1000} seconds
Text: ${settings.text ? '✅ Set' : '❌ Not set'}
Image: ${settings.image ? '✅ Set' : '❌ Not set'}
Voice: ${settings.voice ? '✅ Set' : '❌ Not set'}
File: ${settings.file ? '✅ Set' : '❌ Not set'}

WhatsApp: ${waReady ? '🟢 Connected' : '🟡 Not connected'}`;
}

let waReady = false;
let qrBusy = false;
let pending = new Map();

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(DATA_DIR, 'wa-session')
  }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-accelerated-2d-canvas'
    ]
  }
});

client.on('qr', async (qr) => {
  if (qrBusy || !settings.adminChatId) return;
  qrBusy = true;
  try {
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 700 });
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    await bot.sendPhoto(settings.adminChatId, buffer, {
      caption: '📱 Scan this QR with WhatsApp → Linked devices.'
    });
  } catch (e) {
    console.error('QR send error:', e);
  } finally {
    setTimeout(() => { qrBusy = false; }, 5000);
  }
});

client.on('ready', async () => {
  waReady = true;
  console.log('WhatsApp READY');
  if (settings.adminChatId) {
    await bot.sendMessage(settings.adminChatId, '✅ WhatsApp connected successfully.', keyboard).catch(() => {});
  }
});

client.on('authenticated', () => console.log('WhatsApp authenticated'));

client.on('auth_failure', (msg) => {
  waReady = false;
  console.error('WhatsApp authentication failure:', msg);
});

client.on('disconnected', (reason) => {
  waReady = false;
  console.log('WhatsApp disconnected:', reason);
});

client.on('message', async (msg) => {
  if (!settings.autoReply || msg.fromMe || msg.isStatus) return;

  const delay = Number(settings.delayMs) || 10000;
  await new Promise(resolve => setTimeout(resolve, delay));

  try {
    if (!waReady) return;

    if (settings.text) {
      await msg.reply(settings.text);
    }

    if (settings.image && fs.existsSync(settings.image)) {
      const media = MessageMedia.fromFilePath(settings.image);
      await msg.reply(media);
    }

    if (settings.voice && fs.existsSync(settings.voice)) {
      const media = MessageMedia.fromFilePath(settings.voice);
      await msg.reply(media);
    }

    if (settings.file && fs.existsSync(settings.file)) {
      const media = MessageMedia.fromFilePath(settings.file);
      await msg.reply(media);
    }
  } catch (e) {
    console.error('Auto-reply error:', e);
  }
});

function setPending(chatId, type) {
  pending.set(chatId, type);
}

bot.onText(/\/start/, async (msg) => {
  settings.adminChatId = msg.chat.id;
  saveSettings();
  await bot.sendMessage(msg.chat.id, statusText(), keyboard);
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  settings.adminChatId = chatId;

  const waiting = pending.get(chatId);

  if (waiting === 'text') {
    settings.text = msg.text;
    pending.delete(chatId);
    saveSettings();
    return bot.sendMessage(chatId, '✅ Auto-reply text saved.', keyboard);
  }

  if (waiting === 'image' && msg.photo?.length) {
    const fileId = msg.photo.at(-1).file_id;
    const file = await bot.getFile(fileId);
    const dest = path.join(MEDIA_DIR, 'reply-image.jpg');
    await bot.downloadFile(fileId, MEDIA_DIR);
    const downloaded = path.join(MEDIA_DIR, path.basename(file.file_path));
    fs.renameSync(downloaded, dest);
    settings.image = dest;
    pending.delete(chatId);
    saveSettings();
    return bot.sendMessage(chatId, '✅ Image saved.', keyboard);
  }

  if (waiting === 'voice' && (msg.voice || msg.audio)) {
    const fileId = msg.voice?.file_id || msg.audio?.file_id;
    const file = await bot.getFile(fileId);
    await bot.downloadFile(fileId, MEDIA_DIR);
    settings.voice = path.join(MEDIA_DIR, path.basename(file.file_path));
    pending.delete(chatId);
    saveSettings();
    return bot.sendMessage(chatId, '✅ Voice saved.', keyboard);
  }

  if (waiting === 'file' && msg.document) {
    const fileId = msg.document.file_id;
    const file = await bot.getFile(fileId);
    await bot.downloadFile(fileId, MEDIA_DIR);
    settings.file = path.join(MEDIA_DIR, path.basename(file.file_path));
    pending.delete(chatId);
    saveSettings();
    return bot.sendMessage(chatId, '✅ File saved.', keyboard);
  }

  if (msg.text === '📱 Add WhatsApp') {
    settings.adminChatId = chatId;
    saveSettings();
    if (waReady) return bot.sendMessage(chatId, '✅ WhatsApp is already connected.', keyboard);
    bot.sendMessage(chatId, 'Starting WhatsApp session. QR will appear here when ready.', keyboard);
    client.initialize().catch(e => console.error('Initialize error:', e));
    return;
  }

  if (msg.text === '🤖 Auto Reply') {
    settings.autoReply = !settings.autoReply;
    saveSettings();
    return bot.sendMessage(chatId, `Auto Reply: ${settings.autoReply ? '🟢 ON' : '🔴 OFF'}\nDelay: 10 seconds.`, keyboard);
  }

  if (msg.text === '✍️ Set Text') {
    setPending(chatId, 'text');
    return bot.sendMessage(chatId, 'Send the text you want the bot to reply with.', keyboard);
  }

  if (msg.text === '🖼️ Set Image') {
    setPending(chatId, 'image');
    return bot.sendMessage(chatId, 'Send an image here. It will be used as the auto-reply image.', keyboard);
  }

  if (msg.text === '🎙️ Set Voice') {
    setPending(chatId, 'voice');
    return bot.sendMessage(chatId, 'Send a voice/audio file here.', keyboard);
  }

  if (msg.text === '📎 Set File') {
    setPending(chatId, 'file');
    return bot.sendMessage(chatId, 'Send a document/file here.', keyboard);
  }

  if (msg.text === '🔄 Reply 2') {
    return bot.sendMessage(chatId, 'Reply 2 is not enabled in this fresh build.', keyboard);
  }

  if (msg.text === '📊 Status') {
    return bot.sendMessage(chatId, statusText(), keyboard);
  }
});

console.log('Telegram bot started.');
console.log('Waiting for Telegram /start...');
