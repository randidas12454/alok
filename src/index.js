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
  text: 'Hello! Thanks for your message. We will reply soon.',
  reply2: '',
  reply2Image: null,
  image: null,
  voice: null,
  file: null,
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

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const pending = new Map();
const accounts = new Map();
let accountCounter = 0;

function accountLabel(id) {
  const item = settings.accounts.find(a => a.id === id);
  return item?.name || id;
}

function makeKeyboard() {
  const rows = [
    [
      { text: '📱 Add WhatsApp' },
      { text: '🚪 Logout WhatsApp' }
    ],
    [
      { text: '📋 Accounts' },
      { text: '🤖 Auto Reply' }
    ],
    [
      { text: '✍️ Set Text' },
      { text: '🖼️ Set Image' }
    ],
    [
      { text: '🎙️ Set Voice' },
      { text: '📎 Set File' }
    ],
    [
      { text: '🔄 Reply 2' },
      { text: '🖼️ Reply 2 Image' },
      { text: '📊 Status' }
    ]
  ];

  const connected = settings.accounts.filter(a => a.id);
  for (let i = 0; i < connected.length; i += 2) {
    rows.push(
      connected.slice(i, i + 2).map(a => ({
        text: `📱 ${a.name}`
      }))
    );
  }

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true
    }
  };
}

function statusText() {
  const lines = [
    'WhatsApp Auto Reply Bot',
    '',
    `Auto Reply: ${settings.autoReply ? '🟢 ON' : '🔴 OFF'}`,
    `Delay: ${Number(settings.delayMs) / 1000} seconds`,
    `Text: ${settings.text ? '✅ Set' : '❌ Not set'}`,
    `Reply 2: ${settings.reply2 ? '✅ Set' : '❌ Not set'}
Reply 2 Image: ${settings.reply2Image ? '✅ Set' : '❌ Not set'}`,
    `Image: ${settings.image ? '✅ Set' : '❌ Not set'}`,
    `Voice: ${settings.voice ? '✅ Set' : '❌ Not set'}`,
    `File: ${settings.file ? '✅ Set' : '❌ Not set'}`,
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

function getActiveAccount() {
  if (settings.activeAccountId && accounts.has(settings.activeAccountId)) {
    return accounts.get(settings.activeAccountId);
  }

  for (const meta of settings.accounts) {
    const state = accounts.get(meta.id);
    if (state) {
      settings.activeAccountId = meta.id;
      saveSettings();
      return state;
    }
  }

  return null;
}

async function sendQr(state, qr) {
  if (state.qrBusy) return;
  if (!settings.adminChatId) return;

  state.qrBusy = true;

  try {
    const dataUrl = await QRCode.toDataURL(qr, {
      margin: 1,
      width: 700
    });

    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

    await bot.sendPhoto(settings.adminChatId, buffer, {
      caption: `📱 Scan this QR to connect ${state.name}.\n\nAfter scanning, wait for the connected message.`
    });
  } catch (error) {
    console.error(`QR error (${state.id}):`, error?.message || error);
  } finally {
    setTimeout(() => {
      state.qrBusy = false;
    }, 5000);
  }
}

function createWhatsAppAccount(id, name) {
  const state = {
    id,
    name,
    client: null,
    ready: false,
    initializing: false,
    initialized: false,
    qrBusy: false,
    destroyed: false
  };

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: id,
      dataPath: SESSION_DIR
    }),
    puppeteer: {
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        '/usr/bin/chromium',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-accelerated-2d-canvas',
        '--disable-software-rasterizer'
      ]
    }
  });

  state.client = client;

  client.on('qr', qr => {
    console.log(`WhatsApp QR received for ${name}`);
    sendQr(state, qr);
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
        makeKeyboard()
      ).catch(() => {});
    }
  });

  client.on('auth_failure', msg => {
    state.ready = false;
    state.initializing = false;
    console.error(`WhatsApp auth failure (${name}):`, msg);
  });

  client.on('disconnected', reason => {
    state.ready = false;
    state.initializing = false;
    state.initialized = false;
    console.log(`WhatsApp disconnected (${name}):`, reason);
  });

  client.on('message', async msg => {
    if (!settings.autoReply) return;
    if (msg.fromMe || msg.isStatus) return;
    if (!state.ready) return;

    // Any incoming message counts: text, emoji, image, voice, document, etc.
    const senderId = msg.from;

    if (!state.messageCounts) {
      state.messageCounts = new Map();
    }

    const count = (state.messageCounts.get(senderId) || 0) + 1;
    state.messageCounts.set(senderId, count);

    try {
      // 1st message from this number -> Reply 1 after configured delay.
      if (count === 1) {
        await new Promise(resolve =>
          setTimeout(resolve, Number(settings.delayMs) || 10000)
        );

        if (settings.text) {
          await msg.reply(settings.text);
        }

        if (settings.image && fs.existsSync(settings.image)) {
          await msg.reply(MessageMedia.fromFilePath(settings.image));
        }

        if (settings.voice && fs.existsSync(settings.voice)) {
          await msg.reply(MessageMedia.fromFilePath(settings.voice));
        }

        if (settings.file && fs.existsSync(settings.file)) {
          await msg.reply(MessageMedia.fromFilePath(settings.file));
        }

        return;
      }

      // 2nd message from the same number -> Reply 2 after configured delay.
      if (count === 2) {
        await new Promise(resolve =>
          setTimeout(resolve, Number(settings.delayMs) || 10000)
        );

        if (settings.reply2) {
          await msg.reply(settings.reply2);
        }

        if (settings.reply2Image && fs.existsSync(settings.reply2Image)) {
          await msg.reply(MessageMedia.fromFilePath(settings.reply2Image));
        }

        return;
      }

      // 3rd+ message from this number -> no automatic reply.
    } catch (error) {
      console.error(
        `Auto-reply error (${name}):`,
        error?.message || error
      );
    }
  });

  accounts.set(id, state);
  return state;
}

async function initializeAccount(state) {
  if (!state || state.destroyed) return;
  if (state.ready || state.initializing || state.initialized) return;

  state.initializing = true;

  try {
    console.log(`Starting WhatsApp account: ${state.name}`);
    await state.client.initialize();
    state.initialized = true;
  } catch (error) {
    console.error(
      `WhatsApp initialize error (${state.name}):`,
      error?.message || error
    );
    state.initialized = false;
  } finally {
    state.initializing = false;
  }
}

function nextAccountId() {
  accountCounter += 1;
  let id = `account-${accountCounter}`;
  while (settings.accounts.some(a => a.id === id)) {
    accountCounter += 1;
    id = `account-${accountCounter}`;
  }
  return id;
}

async function addWhatsAppAccount(chatId) {
  const id = nextAccountId();
  const number = settings.accounts.length + 1;
  const name = `WhatsApp ${number}`;

  settings.accounts.push({ id, name });
  settings.activeAccountId = id;
  settings.adminChatId = chatId;
  saveSettings();

  const state = createWhatsAppAccount(id, name);

  await bot.sendMessage(
    chatId,
    `⏳ Starting ${name}...\nQR code will be sent here when ready.`,
    makeKeyboard()
  );

  initializeAccount(state);
}

async function logoutAccount(state) {
  if (!state) {
    return { ok: false, message: 'No WhatsApp account selected.' };
  }

  state.destroyed = true;

  try {
    if (state.ready) {
      await state.client.logout();
    }
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
    settings.activeAccountId =
      settings.accounts[settings.accounts.length - 1]?.id || null;
  }

  saveSettings();

  // Remove only this account's LocalAuth session.
  const sessionPath = path.join(
    SESSION_DIR,
    `session-${state.id}`
  );

  try {
    fs.rmSync(sessionPath, {
      recursive: true,
      force: true
    });
  } catch (error) {
    console.error(`Session cleanup error (${state.name}):`, error?.message || error);
  }

  return {
    ok: true,
    message: `✅ ${state.name} logged out and removed.`
  };
}

function setPending(chatId, type) {
  pending.set(chatId, type);
}

// ===============================
// /start
// ===============================

bot.onText(/^\/start$/, async msg => {
  const chatId = msg.chat.id;

  settings.adminChatId = chatId;
  saveSettings();

  await bot.sendMessage(
    chatId,
    statusText(),
    makeKeyboard()
  );
});

// ===============================
// TELEGRAM MESSAGE HANDLER
// ===============================

bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const waiting = pending.get(chatId);

  settings.adminChatId = chatId;

  // REPLY 2 IMAGE
  if (
    waiting === 'reply2Image' &&
    msg.photo?.length
  ) {
    try {
      const fileId = msg.photo.at(-1).file_id;
      const file = await bot.getFile(fileId);

      await bot.downloadFile(fileId, MEDIA_DIR);

      const downloaded = path.join(
        MEDIA_DIR,
        path.basename(file.file_path)
      );

      const dest = path.join(
        MEDIA_DIR,
        'reply2-image.jpg'
      );

      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }

      fs.renameSync(downloaded, dest);

      settings.reply2Image = dest;

      pending.delete(chatId);
      saveSettings();

      return bot.sendMessage(
        chatId,
        '✅ Reply 2 image saved.',
        keyboard
      );
    } catch (error) {
      console.error(
        'Reply 2 image download error:',
        error?.message || error
      );

      return bot.sendMessage(
        chatId,
        '❌ Reply 2 image save failed.',
        keyboard
      );
    }
  }

  // REPLY 2 TEXT
  if (waiting === 'reply2') {
    if (!msg.text) {
      return bot.sendMessage(
        chatId,
        '❌ Reply 2 must be text. Please send a text message.',
        makeKeyboard()
      );
    }

    settings.reply2 = msg.text;
    pending.delete(chatId);
    saveSettings();

    return bot.sendMessage(
      chatId,
      '✅ Reply 2 saved.',
      makeKeyboard()
    );
  }

  // IMAGE
  if (waiting === 'image' && msg.photo?.length) {
    try {
      const fileId = msg.photo.at(-1).file_id;
      const downloaded = await bot.downloadFile(fileId, MEDIA_DIR);
      const dest = path.join(MEDIA_DIR, 'reply-image.jpg');

      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(downloaded, dest);

      settings.image = dest;
      pending.delete(chatId);
      saveSettings();

      return bot.sendMessage(chatId, '✅ Image saved.', makeKeyboard());
    } catch (error) {
      console.error('Image download error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ Image save failed.', makeKeyboard());
    }
  }

  // VOICE / AUDIO
  if (waiting === 'voice' && (msg.voice || msg.audio)) {
    try {
      const fileId = msg.voice?.file_id || msg.audio?.file_id;
      const downloaded = await bot.downloadFile(fileId, MEDIA_DIR);
      const ext = path.extname(downloaded) || '.ogg';
      const dest = path.join(MEDIA_DIR, `reply-voice${ext}`);

      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(downloaded, dest);

      settings.voice = dest;
      pending.delete(chatId);
      saveSettings();

      return bot.sendMessage(chatId, '✅ Voice saved.', makeKeyboard());
    } catch (error) {
      console.error('Voice download error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ Voice save failed.', makeKeyboard());
    }
  }

  // DOCUMENT / FILE
  if (waiting === 'file' && msg.document) {
    try {
      const fileId = msg.document.file_id;
      const downloaded = await bot.downloadFile(fileId, MEDIA_DIR);

      const safeName = path.basename(
        msg.document.file_name || path.basename(downloaded)
      );

      const dest = path.join(
        MEDIA_DIR,
        `reply-file-${safeName}`
      );

      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(downloaded, dest);

      settings.file = dest;
      pending.delete(chatId);
      saveSettings();

      return bot.sendMessage(chatId, '✅ File saved.', makeKeyboard());
    } catch (error) {
      console.error('File download error:', error?.message || error);
      return bot.sendMessage(chatId, '❌ File save failed.', makeKeyboard());
    }
  }

  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;

  // TEXT
  if (waiting === 'text') {
    settings.text = msg.text;
    pending.delete(chatId);
    saveSettings();

    return bot.sendMessage(
      chatId,
      '✅ Auto-reply text saved.',
      makeKeyboard()
    );
  }

  // ADD ACCOUNT
  if (msg.text === '📱 Add WhatsApp') {
    await addWhatsAppAccount(chatId);
    return;
  }

  // LOGOUT ACTIVE ACCOUNT
  if (msg.text === '🚪 Logout WhatsApp') {
    const state = getActiveAccount();

    if (!state) {
      return bot.sendMessage(
        chatId,
        '❌ No WhatsApp account selected.',
        makeKeyboard()
      );
    }

    const result = await logoutAccount(state);

    return bot.sendMessage(
      chatId,
      result.message,
      makeKeyboard()
    );
  }

  // ACCOUNT LIST
  if (msg.text === '📋 Accounts') {
    if (!settings.accounts.length) {
      return bot.sendMessage(
        chatId,
        '❌ No WhatsApp accounts added yet.\n\nTap 📱 Add WhatsApp to add one.',
        makeKeyboard()
      );
    }

    const lines = ['📋 WhatsApp Accounts', ''];

    for (const meta of settings.accounts) {
      const state = accounts.get(meta.id);
      const status = state?.ready
        ? '🟢 Connected'
        : state?.initializing
          ? '🟡 Starting'
          : '🔴 Offline';

      const active =
        settings.activeAccountId === meta.id
          ? ' ⭐ ACTIVE'
          : '';

      lines.push(`${meta.name} — ${status}${active}`);
    }

    lines.push('');
    lines.push('Tap an account button below to make it active.');

    return bot.sendMessage(
      chatId,
      lines.join('\n'),
      makeKeyboard()
    );
  }

  // SELECT ACCOUNT
  const selected = settings.accounts.find(
    a => msg.text === `📱 ${a.name}`
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
      makeKeyboard()
    );
  }

  // AUTO REPLY
  if (msg.text === '🤖 Auto Reply') {
    settings.autoReply = !settings.autoReply;
    saveSettings();

    return bot.sendMessage(
      chatId,
      `Auto Reply: ${
        settings.autoReply ? '🟢 ON' : '🔴 OFF'
      }\nDelay: ${
        Number(settings.delayMs) / 1000
      } seconds.\n\n${
        settings.autoReply
          ? 'All connected WhatsApp accounts will use the current auto-reply settings.'
          : 'Auto reply is disabled.'
      }`,
      makeKeyboard()
    );
  }

  // SET TEXT
  if (msg.text === '✍️ Set Text') {
    setPending(chatId, 'text');

    return bot.sendMessage(
      chatId,
      'Send the text you want the bot to reply with.',
      makeKeyboard()
    );
  }

  // SET IMAGE
  if (msg.text === '🖼️ Set Image') {
    setPending(chatId, 'image');

    return bot.sendMessage(
      chatId,
      'Send an image here. It will be used as the auto-reply image.',
      makeKeyboard()
    );
  }

  // SET VOICE
  if (msg.text === '🎙️ Set Voice') {
    setPending(chatId, 'voice');

    return bot.sendMessage(
      chatId,
      'Send a voice/audio file here.',
      makeKeyboard()
    );
  }

  // SET FILE
  if (msg.text === '📎 Set File') {
    setPending(chatId, 'file');

    return bot.sendMessage(
      chatId,
      'Send a document/file here.',
      makeKeyboard()
    );
  }

  // REPLY 2 IMAGE
  if (msg.text === '🖼️ Reply 2 Image') {
    setPending(chatId, 'reply2Image');

    return bot.sendMessage(
      chatId,
      'Send the image for Reply 2.',
      keyboard
    );
  }

  // REPLY 2
  if (msg.text === '🔄 Reply 2') {
    setPending(chatId, 'reply2');

    return bot.sendMessage(
      chatId,
      'Send the second auto-reply text now. It will be sent after Reply 1.',
      makeKeyboard()
    );
  }

  // STATUS
  if (msg.text === '📊 Status') {
    return bot.sendMessage(
      chatId,
      statusText(),
      makeKeyboard()
    );
  }
});

// ===============================
// RESTORE SAVED ACCOUNTS
// ===============================

for (const meta of settings.accounts) {
  const match = String(meta.id).match(/^account-(\d+)$/);
  if (match) {
    accountCounter = Math.max(
      accountCounter,
      Number(match[1])
    );
  }

  const state = createWhatsAppAccount(
    meta.id,
    meta.name
  );

  // Start saved accounts one by one.
  // Do not initialize multiple clients simultaneously.
  await new Promise(resolve => setTimeout(resolve, 1000));
  initializeAccount(state);
}

console.log('Telegram bot started.');
console.log('Waiting for Telegram /start...');

bot.on('polling_error', error => {
  console.error(
    'Telegram polling error:',
    error?.message || error
  );
});
