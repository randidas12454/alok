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
const SESSION_DIR = path.join(DATA_DIR, 'wa-session');

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

const defaults = {
  autoReply: false,
  delayMs: 10000,
  text: '',
  image: null,
  voice: null,
  file: null,
  reply2: '',
  reply2Image: null,
  reply2Voice: null,
  reply2File: null,
  adminChatId: null,
  activeAccountId: null,
  accounts: []
};

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      ...defaults,
      ...raw,
      accounts: Array.isArray(raw.accounts) ? raw.accounts : []
    };
  } catch {
    return { ...defaults };
  }
}

let settings = loadSettings();
const saveSettings = () =>
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

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
    [{ text: '🔄 Reply 2' }, { text: '🖼️ Reply 2 Image' }],
    [{ text: '🎙️ Reply 2 Voice' }, { text: '📎 Reply 2 File' }],
    [{ text: '📊 Status' }]
  ];

  for (let i = 0; i < settings.accounts.length; i += 2) {
    rows.push(
      settings.accounts
        .slice(i, i + 2)
        .map(a => ({ text: `📱 ${a.name}` }))
    );
  }

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true
    }
  };
}

function loginKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔢 Login with Number' }],
        [{ text: '📷 Login with QR' }],
        [{ text: '❌ Cancel' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

function normalizePhone(input) {
  const digits = String(input || '').replace(/[^0-9]/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function mediaExists(media) {
  if (!media) return false;
  if (typeof media === 'string') return fs.existsSync(media);
  return Boolean(media.path && fs.existsSync(media.path));
}

function mediaFileId(media) {
  return media && typeof media === 'object' ? media.fileId : null;
}

function statusText() {
  const lines = [
    'WhatsApp Auto Reply Bot',
    '',
    `Auto Reply: ${settings.autoReply ? '🟢 ON' : '🔴 OFF'}`,
    `Delay: ${Number(settings.delayMs) / 1000} seconds`,
    `Reply 1 Text: ${settings.text ? '✅ Set' : '❌ Not set'}`,
    `Reply 1 Image: ${mediaExists(settings.image) ? '✅ Set' : '❌ Not set'}`,
    `Reply 1 Voice: ${mediaExists(settings.voice) ? '✅ Set' : '❌ Not set'}`,
    `Reply 1 File: ${mediaExists(settings.file) ? '✅ Set' : '❌ Not set'}`,
    `Reply 2 Text: ${settings.reply2 ? '✅ Set' : '❌ Not set'}`,
    `Reply 2 Image: ${mediaExists(settings.reply2Image) ? '✅ Set' : '❌ Not set'}`,
    `Reply 2 Voice: ${mediaExists(settings.reply2Voice) ? '✅ Set' : '❌ Not set'}`,
    `Reply 2 File: ${mediaExists(settings.reply2File) ? '✅ Set' : '❌ Not set'}`,
    '',
    'WhatsApp accounts:'
  ];

  if (!settings.accounts.length) {
    lines.push('❌ No accounts added.');
  } else {
    for (const meta of settings.accounts) {
      const state = accounts.get(meta.id);
      const status = state?.ready
        ? '🟢 Connected'
        : state?.initializing
          ? '🟡 Starting'
          : '🔴 Offline';
      const active = settings.activeAccountId === meta.id ? ' ⭐' : '';
      lines.push(`${meta.name}: ${status}${active}`);
    }
  }

  return lines.join('\n');
}

function activeAccount() {
  if (settings.activeAccountId && accounts.has(settings.activeAccountId)) {
    return accounts.get(settings.activeAccountId);
  }

  for (const meta of settings.accounts) {
    if (accounts.has(meta.id)) {
      settings.activeAccountId = meta.id;
      saveSettings();
      return accounts.get(meta.id);
    }
  }

  return null;
}

async function sendQr(state, qr) {
  if (state.qrBusy || !settings.adminChatId) return;
  state.qrBusy = true;

  try {
    const data = await QRCode.toDataURL(qr, { margin: 1, width: 700 });
    const buffer = Buffer.from(data.split(',')[1], 'base64');
    await bot.sendPhoto(settings.adminChatId, buffer, {
      caption: `📱 Scan this QR to connect ${state.name}.\n\nAfter scanning, wait for the connected message.`
    });
  } catch (error) {
    console.error(`QR error (${state.name}):`, error?.message || error);
  } finally {
    setTimeout(() => {
      state.qrBusy = false;
    }, 3000);
  }
}

async function ensureMediaLocal(media, label) {
  if (!media) {
    console.error(`${label}: media is not configured.`);
    return null;
  }

  if (typeof media === 'string') {
    if (fs.existsSync(media)) return media;
    console.error(`${label}: local media file is missing: ${media}`);
    return null;
  }

  if (media.path && fs.existsSync(media.path)) return media.path;

  if (!media.fileId) {
    console.error(`${label}: media file is missing and no Telegram file_id is stored.`);
    return null;
  }

  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const downloaded = await bot.downloadFile(media.fileId, MEDIA_DIR);
    const destination = media.path || path.join(
      MEDIA_DIR,
      media.name || `media-${Date.now()}`
    );
    if (downloaded !== destination) {
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
      fs.renameSync(downloaded, destination);
    }
    media.path = destination;
    saveSettings();
    console.log(`${label}: media restored from Telegram storage.`);
    return destination;
  } catch (error) {
    console.error(`${label}: media restore failed:`, error?.message || error);
    return null;
  }
}

async function sendReplyMedia(client, chatId, mediaConfig, type, label) {
  const filePath = await ensureMediaLocal(mediaConfig, label);
  if (!filePath) return;

  try {
    const media = MessageMedia.fromFilePath(filePath);
    if (type === 'voice') {
      await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    } else if (type === 'file') {
      await client.sendMessage(chatId, media, { sendMediaAsDocument: true });
    } else {
      await client.sendMessage(chatId, media);
    }
    console.log(`${label}: sent successfully.`);
  } catch (error) {
    console.error(`${label}: WhatsApp send failed:`, error?.message || error);
  }
}

async function saveTelegramMedia(fileId, destination, type, originalName = null) {
  const downloaded = await bot.downloadFile(fileId, MEDIA_DIR);
  if (fs.existsSync(destination)) fs.unlinkSync(destination);
  if (downloaded !== destination) fs.renameSync(downloaded, destination);
  return { fileId, path: destination, type, name: originalName || path.basename(destination) };
}

async function restoreSavedMedia() {
  const fields = [
    ['image', 'Reply 1 image'],
    ['voice', 'Reply 1 voice'],
    ['file', 'Reply 1 file'],
    ['reply2Image', 'Reply 2 image'],
    ['reply2Voice', 'Reply 2 voice'],
    ['reply2File', 'Reply 2 file']
  ];

  let changed = false;
  for (const [field, label] of fields) {
    const media = settings[field];
    if (!media || typeof media === 'string') continue;
    if (media.path && fs.existsSync(media.path)) continue;
    if (!media.fileId) {
      console.error(`${label}: no Telegram file_id available for restore.`);
      continue;
    }
    try {
      const restored = await ensureMediaLocal(media, label);
      if (restored) changed = true;
    } catch (error) {
      console.error(`${label}: startup restore failed:`, error?.message || error);
    }
  }
  if (changed) saveSettings();
}

async function sendReplySet(state, msg, setNumber) {
  if (!settings.autoReply || !state.ready) return;

  const isReply1 = setNumber === 1;
  const configured = isReply1
    ? {
        text: settings.text,
        image: settings.image,
        voice: settings.voice,
        file: settings.file
      }
    : {
        text: settings.reply2,
        image: settings.reply2Image,
        voice: settings.reply2Voice,
        file: settings.reply2File
      };

  if (!configured.text && !configured.image && !configured.voice && !configured.file) {
    return;
  }

  const delay = Number(settings.delayMs);
  if (Number.isFinite(delay) && delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  const chatId = msg.from;
  const prefix = `Reply ${setNumber}`;

  // Each item is independent: a failed media item does not stop the remaining items.
  if (configured.text) {
    try {
      await state.client.sendMessage(chatId, configured.text);
    } catch (error) {
      console.error(`${prefix} text failed (${state.name}):`, error?.message || error);
    }
  }

  await sendReplyMedia(
    state.client,
    chatId,
    configured.image,
    'image',
    `${prefix} image (${state.name})`
  );

  await sendReplyMedia(
    state.client,
    chatId,
    configured.voice,
    'voice',
    `${prefix} voice (${state.name})`
  );

  await sendReplyMedia(
    state.client,
    chatId,
    configured.file,
    'file',
    `${prefix} file (${state.name})`
  );
}

function createAccount(id, name, loginMode = 'qr', phoneNumber = null) {
  const state = {
    id,
    name,
    loginMode,
    phoneNumber,
    client: null,
    ready: false,
    initializing: false,
    initialized: false,
    qrBusy: false,
    destroyed: false,
    messageCounts: new Map()
  };

  const clientOptions = {
    authStrategy: new LocalAuth({
      clientId: id,
      dataPath: SESSION_DIR
    }),
    puppeteer: {
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
      headless: true,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-zygote'
      ]
    }
  };

  // whatsapp-web.js 1.34.7 supports phone-number pairing through this option.
  if (loginMode === 'number' && phoneNumber) {
    clientOptions.pairWithPhoneNumber = {
      phoneNumber,
      showNotification: true,
      intervalMs: 180000
    };
  }

  const client = new Client(clientOptions);
  state.client = client;

  client.on('qr', qr => {
    if (loginMode === 'qr') sendQr(state, qr);
  });

  client.on('code', async code => {
    if (!settings.adminChatId) return;
    await bot.sendMessage(
      settings.adminChatId,
      `🔢 Pairing code for ${state.name}:\n\n${code}\n\nWhatsApp → Linked devices → Link a device → Link with phone number instead.`
    ).catch(() => {});
  });

  client.on('authenticated', () => {
    console.log(`WhatsApp authenticated: ${name}`);
  });

  client.on('ready', async () => {
    state.ready = true;
    state.initializing = false;
    state.initialized = true;
    console.log(`WhatsApp READY: ${name}`);

    if (settings.adminChatId) {
      await bot.sendMessage(
        settings.adminChatId,
        `✅ ${name} connected successfully.`,
        keyboard()
      ).catch(() => {});
    }
  });

  client.on('auth_failure', error => {
    state.ready = false;
    state.initializing = false;
    state.initialized = false;
    console.error(`WhatsApp auth failure (${name}):`, error?.message || error);
  });

  client.on('disconnected', reason => {
    state.ready = false;
    state.initializing = false;
    state.initialized = false;
    console.log(`WhatsApp disconnected (${name}):`, reason);
  });

  client.on('message', async msg => {
    if (!settings.autoReply || msg.fromMe || msg.isStatus || !state.ready) return;

    const senderId = msg.from;
    const count = (state.messageCounts.get(senderId) || 0) + 1;
    state.messageCounts.set(senderId, count);

    try {
      if (count === 1) {
        await sendReplySet(state, msg, 1);
      } else if (count === 2) {
        await sendReplySet(state, msg, 2);
      }
    } catch (error) {
      console.error(`Auto-reply error (${name}):`, error?.message || error);
    }
  });

  accounts.set(id, state);
  return state;
}

async function initializeAccount(state) {
  if (!state || state.destroyed || state.ready || state.initializing || state.initialized) return;

  state.initializing = true;
  try {
    console.log(`Starting WhatsApp account: ${state.name}`);
    await state.client.initialize();
    state.initialized = true;
  } catch (error) {
    state.initialized = false;
    console.error(`Initialize error (${state.name}):`, error?.message || error);
  } finally {
    state.initializing = false;
  }
}

function nextId() {
  do {
    accountCounter += 1;
  } while (settings.accounts.some(a => a.id === `account-${accountCounter}`));
  return `account-${accountCounter}`;
}

async function startNewAccount(chatId, loginMode, phoneNumber = null) {
  const id = nextId();
  const name = `WhatsApp ${settings.accounts.length + 1}`;

  settings.accounts.push({ id, name, loginMode, phoneNumber });
  settings.activeAccountId = id;
  settings.adminChatId = chatId;
  saveSettings();

  const state = createAccount(id, name, loginMode, phoneNumber);

  if (loginMode === 'number') {
    await bot.sendMessage(
      chatId,
      `⏳ Starting ${name} with phone-number login...\n\nNumber: ${phoneNumber}\nA pairing code will appear here.`,
      keyboard()
    );
  } else {
    await bot.sendMessage(
      chatId,
      `⏳ Starting ${name} with QR login...\nQR code will be sent here when ready.`,
      keyboard()
    );
  }

  initializeAccount(state);
}

async function addWhatsAppAccount(chatId) {
  settings.adminChatId = chatId;
  saveSettings();
  return bot.sendMessage(chatId, 'Choose WhatsApp login method:', loginKeyboard());
}

async function logoutAccount(state) {
  if (!state) return { message: '❌ No WhatsApp account selected.' };

  state.destroyed = true;
  try {
    if (state.ready) await state.client.logout();
  } catch (error) {
    console.error(`Logout error (${state.name}):`, error?.message || error);
  }

  try {
    await state.client.destroy();
  } catch (error) {
    console.error(`Destroy error (${state.name}):`, error?.message || error);
  }

  accounts.delete(state.id);
  settings.accounts = settings.accounts.filter(a => a.id !== state.id);

  if (settings.activeAccountId === state.id) {
    settings.activeAccountId = settings.accounts.at(-1)?.id || null;
  }

  saveSettings();

  try {
    fs.rmSync(path.join(SESSION_DIR, `session-${state.id}`), {
      recursive: true,
      force: true
    });
  } catch (error) {
    console.error(`Session cleanup error (${state.name}):`, error?.message || error);
  }

  return { message: `✅ ${state.name} logged out and removed.` };
}

function setPending(chatId, type) {
  pending.set(chatId, type);
}

// Restore Telegram-backed media before serving status/replies.
let mediaRestorePromise = restoreSavedMedia();

// ===============================
// /start
// ===============================

bot.onText(/^\/start$/, async msg => {
  await mediaRestorePromise;
  settings.adminChatId = msg.chat.id;
  saveSettings();
  await bot.sendMessage(msg.chat.id, statusText(), keyboard());
});

// ===============================
// TELEGRAM MESSAGE HANDLER
// ===============================

bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const waiting = pending.get(chatId);
  settings.adminChatId = chatId;

  // -------------------------------
  // Reply 1 media
  // -------------------------------
  if (waiting === 'image' && msg.photo?.length) {
    try {
      const fileId = msg.photo.at(-1).file_id;
      const dest = path.join(MEDIA_DIR, 'reply-image.jpg');
      settings.image = await saveTelegramMedia(fileId, dest, 'image');
      pending.delete(chatId);
      saveSettings();
      return bot.sendMessage(chatId, '✅ Reply 1 image saved and backed up by Telegram file_id.', keyboard());
    } catch (error) {
      console.error('Reply 1 image save error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ Reply 1 image save failed. Check Railway logs.', keyboard());
    }
  }

  if (waiting === 'voice' && (msg.voice || msg.audio)) {
    try {
      const fileId = msg.voice?.file_id || msg.audio?.file_id;
      const originalName = msg.audio?.file_name || 'reply-voice.ogg';
      const ext = path.extname(originalName) || '.ogg';
      const dest = path.join(MEDIA_DIR, `reply-voice${ext}`);
      settings.voice = await saveTelegramMedia(fileId, dest, 'voice', originalName);
      pending.delete(chatId);
      saveSettings();
      return bot.sendMessage(chatId, '✅ Reply 1 voice saved and backed up by Telegram file_id.', keyboard());
    } catch (error) {
      console.error('Reply 1 voice save error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ Reply 1 voice save failed. Check Railway logs.', keyboard());
    }
  }

  if (waiting === 'file' && msg.document) {
    try {
      const fileId = msg.document.file_id;
      const safeName = path.basename(msg.document.file_name || `file-${Date.now()}`);
      const dest = path.join(MEDIA_DIR, `reply-file-${safeName}`);
      settings.file = await saveTelegramMedia(fileId, dest, 'file', safeName);
      pending.delete(chatId);
      saveSettings();
      return bot.sendMessage(chatId, '✅ Reply 1 file saved and backed up by Telegram file_id.', keyboard());
    } catch (error) {
      console.error('Reply 1 file save error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ Reply 1 file save failed. Check Railway logs.', keyboard());
    }
  }

  // -------------------------------
  // Reply 2 media
  // -------------------------------
  if (waiting === 'reply2Image' && msg.photo?.length) {
    try {
      const fileId = msg.photo.at(-1).file_id;
      const dest = path.join(MEDIA_DIR, 'reply2-image.jpg');
      settings.reply2Image = await saveTelegramMedia(fileId, dest, 'image');
      pending.delete(chatId);
      saveSettings();
      return bot.sendMessage(chatId, '✅ Reply 2 image saved and backed up by Telegram file_id.', keyboard());
    } catch (error) {
      console.error('Reply 2 image save error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ Reply 2 image save failed. Check Railway logs.', keyboard());
    }
  }

  if (waiting === 'reply2Voice' && (msg.voice || msg.audio)) {
    try {
      const fileId = msg.voice?.file_id || msg.audio?.file_id;
      const originalName = msg.audio?.file_name || 'reply2-voice.ogg';
      const ext = path.extname(originalName) || '.ogg';
      const dest = path.join(MEDIA_DIR, `reply2-voice${ext}`);
      settings.reply2Voice = await saveTelegramMedia(fileId, dest, 'voice', originalName);
      pending.delete(chatId);
      saveSettings();
      return bot.sendMessage(chatId, '✅ Reply 2 voice saved and backed up by Telegram file_id.', keyboard());
    } catch (error) {
      console.error('Reply 2 voice save error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ Reply 2 voice save failed. Check Railway logs.', keyboard());
    }
  }

  if (waiting === 'reply2File' && msg.document) {
    try {
      const fileId = msg.document.file_id;
      const safeName = path.basename(msg.document.file_name || `file-${Date.now()}`);
      const dest = path.join(MEDIA_DIR, `reply2-file-${safeName}`);
      settings.reply2File = await saveTelegramMedia(fileId, dest, 'file', safeName);
      pending.delete(chatId);
      saveSettings();
      return bot.sendMessage(chatId, '✅ Reply 2 file saved and backed up by Telegram file_id.', keyboard());
    } catch (error) {
      console.error('Reply 2 file save error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ Reply 2 file save failed. Check Railway logs.', keyboard());
    }
  }

  // Text-only states and buttons come after media handlers.
  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;

  // -------------------------------
  // Pending text / phone input
  // -------------------------------
  if (waiting === 'text') {
    settings.text = msg.text;
    pending.delete(chatId);
    saveSettings();
    return bot.sendMessage(chatId, '✅ Reply 1 text saved.', keyboard());
  }

  if (waiting === 'reply2') {
    settings.reply2 = msg.text;
    pending.delete(chatId);
    saveSettings();
    return bot.sendMessage(chatId, '✅ Reply 2 text saved.', keyboard());
  }

  if (waiting === 'phone') {
    if (msg.text === '❌ Cancel') {
      pending.delete(chatId);
      return bot.sendMessage(chatId, 'Cancelled.', keyboard());
    }

    const phone = normalizePhone(msg.text);
    if (!phone) {
      return bot.sendMessage(
        chatId,
        '❌ Invalid number. Send the full international number, e.g. +919046432302'
      );
    }

    pending.delete(chatId);
    return startNewAccount(chatId, 'number', phone);
  }

  // -------------------------------
  // Main buttons
  // -------------------------------
  if (msg.text === '📱 Add WhatsApp') {
    return addWhatsAppAccount(chatId);
  }

  if (msg.text === '🔢 Login with Number') {
    setPending(chatId, 'phone');
    return bot.sendMessage(
      chatId,
      'Send the complete phone number with country code.\nExample: +919046432302\n+91 is only an example — any country code is accepted.'
    );
  }

  if (msg.text === '📷 Login with QR') {
    pending.delete(chatId);
    return startNewAccount(chatId, 'qr');
  }

  if (msg.text === '❌ Cancel') {
    pending.delete(chatId);
    return bot.sendMessage(chatId, 'Cancelled.', keyboard());
  }

  if (msg.text === '🚪 Logout WhatsApp') {
    const result = await logoutAccount(activeAccount());
    return bot.sendMessage(chatId, result.message, keyboard());
  }

  if (msg.text === '📋 Accounts') {
    await mediaRestorePromise;
    return bot.sendMessage(chatId, statusText(), keyboard());
  }

  const selected = settings.accounts.find(
    account => msg.text === `📱 ${account.name}`
  );

  if (selected) {
    settings.activeAccountId = selected.id;
    saveSettings();
    const state = accounts.get(selected.id);
    return bot.sendMessage(
      chatId,
      `✅ Active account: ${selected.name}\nStatus: ${
        state?.ready
          ? '🟢 Connected'
          : state?.initializing
            ? '🟡 Starting'
            : '🔴 Offline'
      }`,
      keyboard()
    );
  }

  if (msg.text === '🤖 Auto Reply') {
    settings.autoReply = !settings.autoReply;
    saveSettings();
    return bot.sendMessage(
      chatId,
      `Auto Reply: ${settings.autoReply ? '🟢 ON' : '🔴 OFF'}\nDelay: ${
        Number(settings.delayMs) / 1000
      } seconds.\n\nFirst incoming message → Reply 1 (Text + Image + Voice + File).\nSecond incoming message → Reply 2 (Text + Image + Voice + File).`,
      keyboard()
    );
  }

  if (msg.text === '✍️ Set Text') {
    setPending(chatId, 'text');
    return bot.sendMessage(chatId, 'Send the Reply 1 text.', keyboard());
  }

  if (msg.text === '🖼️ Set Image') {
    setPending(chatId, 'image');
    return bot.sendMessage(chatId, 'Send the Reply 1 image.', keyboard());
  }

  if (msg.text === '🎙️ Set Voice') {
    setPending(chatId, 'voice');
    return bot.sendMessage(chatId, 'Send the Reply 1 voice/audio.', keyboard());
  }

  if (msg.text === '📎 Set File') {
    setPending(chatId, 'file');
    return bot.sendMessage(chatId, 'Send the Reply 1 document/file.', keyboard());
  }

  if (msg.text === '🔄 Reply 2') {
    setPending(chatId, 'reply2');
    return bot.sendMessage(chatId, 'Send the Reply 2 text.', keyboard());
  }

  if (msg.text === '🖼️ Reply 2 Image') {
    setPending(chatId, 'reply2Image');
    return bot.sendMessage(chatId, 'Send the Reply 2 image.', keyboard());
  }

  if (msg.text === '🎙️ Reply 2 Voice') {
    setPending(chatId, 'reply2Voice');
    return bot.sendMessage(chatId, 'Send the Reply 2 voice/audio.', keyboard());
  }

  if (msg.text === '📎 Reply 2 File') {
    setPending(chatId, 'reply2File');
    return bot.sendMessage(chatId, 'Send the Reply 2 document/file.', keyboard());
  }

  if (msg.text === '📊 Status') {
    await mediaRestorePromise;
    return bot.sendMessage(chatId, statusText(), keyboard());
  }
});

// ===============================
// RESTORE SAVED ACCOUNTS
// ===============================

for (const meta of settings.accounts) {
  const match = String(meta.id).match(/^account-(\d+)$/);
  if (match) {
    accountCounter = Math.max(accountCounter, Number(match[1]));
  }

  const state = createAccount(
    meta.id,
    meta.name,
    meta.loginMode || 'qr',
    meta.phoneNumber || null
  );

  await new Promise(resolve => setTimeout(resolve, 1000));
  initializeAccount(state);
}

console.log('Telegram bot started.');
console.log('Waiting for Telegram /start...');

bot.on('polling_error', error => {
  console.error('Telegram polling error:', error?.message || error);
});
