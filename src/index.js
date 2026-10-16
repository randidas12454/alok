import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
import fs from 'node:fs';
import path from 'node:path';

const { Client, LocalAuth, MessageMedia } = pkg;

// ===============================
// TELEGRAM BOT TOKEN
// ===============================

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing. Add it in Railway Variables.');
  process.exit(1);
}

// ===============================
// DATA DIRECTORIES
// ===============================

const DATA_DIR = path.resolve('data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ===============================
// DEFAULT SETTINGS
// ===============================

const defaults = {
  autoReply: false,
  delayMs: 10000,
  text: 'Hello! Thanks for your message. We will reply soon.',
  image: null,
  voice: null,
  file: null,
  adminChatId: null
};

// ===============================
// LOAD SETTINGS
// ===============================

function loadSettings() {
  try {
    return {
      ...defaults,
      ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    };
  } catch {
    return { ...defaults };
  }
}

let settings = loadSettings();

// ===============================
// SAVE SETTINGS
// ===============================

function saveSettings() {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(settings, null, 2)
  );
}

// ===============================
// TELEGRAM BOT
// ===============================

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

// ===============================
// TELEGRAM KEYBOARD
// ===============================

const keyboard = {
  reply_markup: {
    keyboard: [
      [
        { text: '📱 Add WhatsApp' },
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
        { text: '📊 Status' }
      ]
    ],
    resize_keyboard: true
  }
};

// ===============================
// WHATSAPP STATUS
// ===============================

let waReady = false;
let waInitializing = false;
let waInitialized = false;
let qrBusy = false;

const pending = new Map();

// ===============================
// STATUS TEXT
// ===============================

function statusText() {
  return `WhatsApp Auto Reply Bot

Auto Reply: ${settings.autoReply ? '🟢 ON' : '🔴 OFF'}
Delay: ${settings.delayMs / 1000} seconds
Text: ${settings.text ? '✅ Set' : '❌ Not set'}
Image: ${settings.image ? '✅ Set' : '❌ Not set'}
Voice: ${settings.voice ? '✅ Set' : '❌ Not set'}
File: ${settings.file ? '✅ Set' : '❌ Not set'}

WhatsApp: ${waReady ? '🟢 Connected' : '🟡 Not connected'}
Initializing: ${waInitializing ? '🟡 Yes' : '⚪ No'}`;
}

// ===============================
// WHATSAPP CLIENT
// ===============================

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(DATA_DIR, 'wa-session')
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

// ===============================
// SAFE WHATSAPP INITIALIZE
// ===============================

async function initializeWhatsApp() {

  // Already connected
  if (waReady) {
    console.log('WhatsApp is already ready.');
    return;
  }

  // Already initializing
  if (waInitializing) {
    console.log('WhatsApp initialization already running.');
    return;
  }

  // Already initialized
  if (waInitialized) {
    console.log('WhatsApp client was already initialized.');
    return;
  }

  waInitializing = true;

  try {

    console.log('Starting WhatsApp client...');

    await client.initialize();

    waInitialized = true;

    console.log('WhatsApp initialize completed.');

  } catch (error) {

    console.error(
      'WhatsApp initialize error:',
      error?.message || error
    );

  } finally {

    waInitializing = false;

  }
}

// ===============================
// WHATSAPP QR
// ===============================

client.on('qr', async (qr) => {

  console.log('WhatsApp QR received.');

  if (qrBusy) {
    console.log('QR already being sent.');
    return;
  }

  if (!settings.adminChatId) {
    console.log('No Telegram admin chat ID available.');
    return;
  }

  qrBusy = true;

  try {

    const dataUrl = await QRCode.toDataURL(qr, {
      margin: 1,
      width: 700
    });

    const base64 = dataUrl.split(',')[1];

    const buffer = Buffer.from(
      base64,
      'base64'
    );

    await bot.sendPhoto(
      settings.adminChatId,
      buffer,
      {
        caption:
          '📱 Scan this QR with WhatsApp → Linked devices.'
      }
    );

    console.log('WhatsApp QR sent to Telegram.');

  } catch (error) {

    console.error(
      'QR send error:',
      error?.message || error
    );

  } finally {

    setTimeout(() => {
      qrBusy = false;
    }, 5000);

  }
});

// ===============================
// WHATSAPP READY
// ===============================

client.on('ready', async () => {

  waReady = true;
  waInitializing = false;
  waInitialized = true;

  console.log('WhatsApp READY');

  if (settings.adminChatId) {

    await bot
      .sendMessage(
        settings.adminChatId,
        '✅ WhatsApp connected successfully.',
        keyboard
      )
      .catch(() => {});

  }

});

// ===============================
// WHATSAPP AUTHENTICATED
// ===============================

client.on('authenticated', () => {

  console.log('WhatsApp authenticated');

});

// ===============================
// WHATSAPP AUTH FAILURE
// ===============================

client.on('auth_failure', (msg) => {

  waReady = false;

  console.error(
    'WhatsApp authentication failure:',
    msg
  );

});

// ===============================
// WHATSAPP DISCONNECTED
// ===============================

client.on('disconnected', (reason) => {

  waReady = false;
  waInitialized = false;
  waInitializing = false;

  console.log(
    'WhatsApp disconnected:',
    reason
  );

});

// ===============================
// WHATSAPP MESSAGES
// ===============================

client.on('message', async (msg) => {

  // Ignore if auto reply is disabled
  if (!settings.autoReply) {
    return;
  }

  // Ignore own messages
  if (msg.fromMe) {
    return;
  }

  // Ignore WhatsApp status
  if (msg.isStatus) {
    return;
  }

  const delay =
    Number(settings.delayMs) || 10000;

  await new Promise((resolve) => {
    setTimeout(resolve, delay);
  });

  try {

    if (!waReady) {
      return;
    }

    // ===============================
    // TEXT REPLY
    // ===============================

    if (settings.text) {

      await msg.reply(
        settings.text
      );

    }

    // ===============================
    // IMAGE REPLY
    // ===============================

    if (
      settings.image &&
      fs.existsSync(settings.image)
    ) {

      const media =
        MessageMedia.fromFilePath(
          settings.image
        );

      await msg.reply(media);

    }

    // ===============================
    // VOICE REPLY
    // ===============================

    if (
      settings.voice &&
      fs.existsSync(settings.voice)
    ) {

      const media =
        MessageMedia.fromFilePath(
          settings.voice
        );

      await msg.reply(media);

    }

    // ===============================
    // FILE REPLY
    // ===============================

    if (
      settings.file &&
      fs.existsSync(settings.file)
    ) {

      const media =
        MessageMedia.fromFilePath(
          settings.file
        );

      await msg.reply(media);

    }

  } catch (error) {

    console.error(
      'Auto-reply error:',
      error?.message || error
    );

  }

});

// ===============================
// PENDING ACTION
// ===============================

function setPending(chatId, type) {

  pending.set(
    chatId,
    type
  );

}

// ===============================
// TELEGRAM /START
// ===============================

bot.onText(/^\/start$/, async (msg) => {

  const chatId = msg.chat.id;

  settings.adminChatId = chatId;

  saveSettings();

  await bot.sendMessage(
    chatId,
    statusText(),
    keyboard
  );

});

// ===============================
// TELEGRAM MESSAGES
// ===============================

bot.on('message', async (msg) => {

  if (!msg.text) {
    return;
  }

  if (msg.text.startsWith('/')) {
    return;
  }

  const chatId = msg.chat.id;

  settings.adminChatId = chatId;

  // ===============================
  // WAITING FOR TEXT
  // ===============================

  const waiting = pending.get(chatId);

  if (waiting === 'text') {

    settings.text = msg.text;

    pending.delete(chatId);

    saveSettings();

    return bot.sendMessage(
      chatId,
      '✅ Auto-reply text saved.',
      keyboard
    );

  }

  // ===============================
  // WAITING FOR IMAGE
  // ===============================

  if (
    waiting === 'image' &&
    msg.photo?.length
  ) {

    try {

      const fileId =
        msg.photo.at(-1).file_id;

      const file =
        await bot.getFile(fileId);

      await bot.downloadFile(
        fileId,
        MEDIA_DIR
      );

      const downloaded =
        path.join(
          MEDIA_DIR,
          path.basename(file.file_path)
        );

      const dest =
        path.join(
          MEDIA_DIR,
          'reply-image.jpg'
        );

      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }

      fs.renameSync(
        downloaded,
        dest
      );

      settings.image = dest;

      pending.delete(chatId);

      saveSettings();

      return bot.sendMessage(
        chatId,
        '✅ Image saved.',
        keyboard
      );

    } catch (error) {

      console.error(
        'Image download error:',
        error?.message || error
      );

      return bot.sendMessage(
        chatId,
        '❌ Image save failed.',
        keyboard
      );

    }

  }

  // ===============================
  // WAITING FOR VOICE
  // ===============================

  if (
    waiting === 'voice' &&
    (msg.voice || msg.audio)
  ) {

    try {

      const fileId =
        msg.voice?.file_id ||
        msg.audio?.file_id;

      const file =
        await bot.getFile(fileId);

      await bot.downloadFile(
        fileId,
        MEDIA_DIR
      );

      settings.voice =
        path.join(
          MEDIA_DIR,
          path.basename(file.file_path)
        );

      pending.delete(chatId);

      saveSettings();

      return bot.sendMessage(
        chatId,
        '✅ Voice saved.',
        keyboard
      );

    } catch (error) {

      console.error(
        'Voice download error:',
        error?.message || error
      );

      return bot.sendMessage(
        chatId,
        '❌ Voice save failed.',
        keyboard
      );

    }

  }

  // ===============================
  // WAITING FOR FILE
  // ===============================

  if (
    waiting === 'file' &&
    msg.document
  ) {

    try {

      const fileId =
        msg.document.file_id;

      const file =
        await bot.getFile(fileId);

      await bot.downloadFile(
        fileId,
        MEDIA_DIR
      );

      settings.file =
        path.join(
          MEDIA_DIR,
          path.basename(file.file_path)
        );

      pending.delete(chatId);

      saveSettings();

      return bot.sendMessage(
        chatId,
        '✅ File saved.',
        keyboard
      );

    } catch (error) {

      console.error(
        'File download error:',
        error?.message || error
      );

      return bot.sendMessage(
        chatId,
        '❌ File save failed.',
        keyboard
      );

    }

  }

  // ===============================
  // ADD WHATSAPP
  // ===============================

  if (msg.text === '📱 Add WhatsApp') {

    settings.adminChatId = chatId;

    saveSettings();

    if (waReady) {

      return bot.sendMessage(
        chatId,
        '✅ WhatsApp is already connected.',
        keyboard
      );

    }

    if (waInitializing) {

      return bot.sendMessage(
        chatId,
        '⏳ WhatsApp is already starting. Please wait for the QR.',
        keyboard
      );

    }

    if (waInitialized) {

      return bot.sendMessage(
        chatId,
        '⏳ WhatsApp client is already initialized. Please wait.',
        keyboard
      );

    }

    await bot.sendMessage(
      chatId,
      '⏳ Starting WhatsApp session. QR will appear here when ready.',
      keyboard
    );

    initializeWhatsApp();

    return;
  }

  // ===============================
  // AUTO REPLY
  // ===============================

  if (msg.text === '🤖 Auto Reply') {

    settings.autoReply =
      !settings.autoReply;

    saveSettings();

    return bot.sendMessage(
      chatId,
      `Auto Reply: ${
        settings.autoReply
          ? '🟢 ON'
          : '🔴 OFF'
      }\nDelay: ${
        settings.delayMs / 1000
      } seconds.`,
      keyboard
    );

  }

  // ===============================
  // SET TEXT
  // ===============================

  if (msg.text === '✍️ Set Text') {

    setPending(
      chatId,
      'text'
    );

    return bot.sendMessage(
      chatId,
      'Send the text you want the bot to reply with.',
      keyboard
    );

  }

  // ===============================
  // SET IMAGE
  // ===============================

  if (msg.text === '🖼️ Set Image') {

    setPending(
      chatId,
      'image'
    );

    return bot.sendMessage(
      chatId,
      'Send an image here. It will be used as the auto-reply image.',
      keyboard
    );

  }

  // ===============================
  // SET VOICE
  // ===============================

  if (msg.text === '🎙️ Set Voice') {

    setPending(
      chatId,
      'voice'
    );

    return bot.sendMessage(
      chatId,
      'Send a voice/audio file here.',
      keyboard
    );

  }

  // ===============================
  // SET FILE
  // ===============================

  if (msg.text === '📎 Set File') {

    setPending(
      chatId,
      'file'
    );

    return bot.sendMessage(
      chatId,
      'Send a document/file here.',
      keyboard
    );

  }

  // ===============================
  // REPLY 2
  // ===============================

  if (msg.text === '🔄 Reply 2') {

    return bot.sendMessage(
      chatId,
      'Reply 2 is not enabled in this build.',
      keyboard
    );

  }

  // ===============================
  // STATUS
  // ===============================

  if (msg.text === '📊 Status') {

    return bot.sendMessage(
      chatId,
      statusText(),
      keyboard
    );

  }

});

// ===============================
// START LOG
// ===============================

console.log('Telegram bot started.');
console.log('Waiting for Telegram /start...');

// ===============================
// TELEGRAM POLLING ERROR
// ===============================

bot.on('polling_error', (error) => {

  console.error(
    'Telegram polling error:',
    error?.message || error
  );

});