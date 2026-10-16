import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode';
import TelegramBot from 'node-telegram-bot-api';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = Number(process.env.PORT || 3000);
const DELAY = Number(process.env.REPLY_DELAY_MS || 10000);

if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing');

const bot = new TelegramBot(TOKEN, { polling: true });
const dataDir = path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });

const state = {
  autoReply: false,
  repliedContacts: new Set(),
  text: 'Hello! This is an automatic reply.',
  image: null,
  voice: null,
  file: null,
  reply2: {
    enabled: false,
    text: '',
    image1: null,
    image2: null
  },
  qr: null,
  connected: false
};

let client;

function menu() {
  return [
    ['📱 Add WhatsApp', '🤖 Auto Reply'],
    ['✍️ Set Text', '🖼️ Set Image'],
    ['🎙️ Set Voice', '📎 Set File'],
    ['🔁 Reply 2', '📊 Status']
  ];
}

async function sendMenu(chatId, text='Choose an option:') {
  return bot.sendMessage(chatId, text, {
    reply_markup: { keyboard: menu(), resize_keyboard: true }
  });
}

bot.onText(/\/start/, async (msg) => {
  await sendMenu(msg.chat.id, 'WhatsApp Auto Reply Bot\\nFixed reply delay: 10 seconds.');
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const t = msg.text;

  if (t === '📱 Add WhatsApp') {
    await bot.sendMessage(chatId, 'Starting WhatsApp session. QR will appear here when ready.');
    await startWhatsApp(chatId);
  } else if (t === '🤖 Auto Reply') {
    state.autoReply = !state.autoReply;
    await bot.sendMessage(chatId, `Auto Reply: ${state.autoReply ? '🟢 ON' : '🔴 OFF'}\\nDelay: 10 seconds`);
  } else if (t === '✍️ Set Text') {
    await bot.sendMessage(chatId, 'Send the text you want to use as the auto-reply.');
    state.waiting = 'text';
  } else if (t === '🖼️ Set Image') {
    await bot.sendMessage(chatId, 'Send an image. It will be used as the auto-reply image.');
    state.waiting = 'image';
  } else if (t === '🎙️ Set Voice') {
    await bot.sendMessage(chatId, 'Send a voice message. It will be used as the auto-reply voice.');
    state.waiting = 'voice';
  } else if (t === '📎 Set File') {
    await bot.sendMessage(chatId, 'Send a document/file. It will be used as the auto-reply file.');
    state.waiting = 'file';
  } else if (t === '🔁 Reply 2') {
    await bot.sendMessage(chatId,
      `🔁 REPLY 2\n\nStatus: ${state.reply2.enabled ? '🟢 ON' : '🔴 OFF'}\n` +
      `Reply 2 is sent when the same contact messages again after Reply 1.`
    , {
      reply_markup: { inline_keyboard: [
        [{text: state.reply2.enabled ? '🔴 DISABLE REPLY 2' : '🟢 ENABLE REPLY 2', callback_data: 'reply2_toggle'}],
        [{text: '✍️ Set Text', callback_data: 'reply2_text'}],
        [{text: '🖼️ Set Image 1', callback_data: 'reply2_img1'}, {text: '🗑️ Clear Image 1', callback_data: 'reply2_clear_img1'}],
        [{text: '🖼️ Set Image 2', callback_data: 'reply2_img2'}, {text: '🗑️ Clear Image 2', callback_data: 'reply2_clear_img2'}]
      ]}
    });
  } else if (t === '📊 Status') {
    await bot.sendMessage(chatId,
      `WhatsApp: ${state.connected ? '🟢 Connected' : '🔴 Not connected'}\\n` +
      `Auto Reply: ${state.autoReply ? '🟢 ON' : '🔴 OFF'}\\n` +
      `Reply delay: 10 seconds`
    );
  } else if (state.waiting === 'text') {
    state.text = t;
    state.waiting = null;
    await bot.sendMessage(chatId, '✅ Auto-reply text saved.');
  } else if (state.waiting === 'reply2_text') {
    state.reply2.text = t;
    state.waiting = null;
    await bot.sendMessage(chatId, '✅ Reply 2 text saved.');
  }
});

bot.on('photo', async (msg) => {
  if (!['image', 'reply2_img1', 'reply2_img2'].includes(state.waiting)) return;
  const p = await downloadTelegramFile(msg.photo.at(-1).file_id, 'image');
  if (state.waiting === 'image') state.image = p;
  if (state.waiting === 'reply2_img1') state.reply2.image1 = p;
  if (state.waiting === 'reply2_img2') state.reply2.image2 = p;
  state.waiting = null;
  await bot.sendMessage(msg.chat.id, '✅ Image saved.');
});

bot.on('voice', async (msg) => {
  if (state.waiting !== 'voice') return;
  const p = await downloadTelegramFile(msg.voice.file_id, 'voice.ogg');
  state.voice = p; state.waiting = null;
  await bot.sendMessage(msg.chat.id, '✅ Voice saved.');
});

bot.on('document', async (msg) => {
  if (state.waiting !== 'file') return;
  const p = await downloadTelegramFile(msg.document.file_id, msg.document.file_name || 'file');
  state.file = p; state.waiting = null;
  await bot.sendMessage(msg.chat.id, '✅ File saved.');
});

async function downloadTelegramFile(fileId, filename) {
  const url = await bot.getFileLink(fileId);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Telegram file download failed');
  const ext = path.extname(filename) || '.bin';
  const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const out = path.join(dataDir, safe);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

async function startWhatsApp(chatId) {
  if (client) return;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.resolve('data', 'wa-session') }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
  });

  client.on('qr', async (qr) => {
    state.qr = await qrcode.toDataURL(qr);
    const base64 = state.qr.split(',')[1];
    await bot.sendPhoto(chatId, Buffer.from(base64, 'base64'), {
      caption: '📱 Scan this QR with WhatsApp. Session is stored locally.'
    });
  });

  client.on('ready', async () => {
    state.connected = true;
    await bot.sendMessage(chatId, '✅ WhatsApp connected.');
  });

  client.on('disconnected', async () => {
    state.connected = false;
    await bot.sendMessage(chatId, '⚠️ WhatsApp session disconnected.');
  });

  client.on('message', async (message) => {
    if (!state.autoReply || message.fromMe) return;

    // Fixed 10-second delay before replying.
    await new Promise(resolve => setTimeout(resolve, DELAY));

    try {
      const key = message.from;
      const isReply2 = state.repliedContacts.has(key) && state.reply2.enabled;

      if (!isReply2) {
        if (state.text) await message.reply(state.text);
        if (state.image) {
          const media = MessageMedia.fromFilePath(state.image);
          await client.sendMessage(message.from, media);
        }
        if (state.voice) {
          const media = MessageMedia.fromFilePath(state.voice);
          media.mimetype = 'audio/ogg; codecs=opus';
          await client.sendMessage(message.from, media, { sendAudioAsVoice: true });
        }
        if (state.file) {
          const media = MessageMedia.fromFilePath(state.file);
          await client.sendMessage(message.from, media);
        }
        state.repliedContacts.add(key);
      } else {
        if (state.reply2.text) await message.reply(state.reply2.text);
        for (const p of [state.reply2.image1, state.reply2.image2]) {
          if (p) {
            const media = MessageMedia.fromFilePath(p);
            await client.sendMessage(message.from, media);
          }
        }
      }
    } catch (err) {
      console.error('Auto-reply error:', err.message);
    }
  });

  await client.initialize();
}


bot.on('callback_query', async (q) => {
  const id = q.message.chat.id;
  const action = q.data;
  await bot.answerCallbackQuery(q.id);

  if (action === 'reply2_toggle') {
    state.reply2.enabled = !state.reply2.enabled;
    return bot.sendMessage(id, `Reply 2: ${state.reply2.enabled ? '🟢 ON' : '🔴 OFF'}`);
  }
  if (action === 'reply2_text') {
    state.waiting = 'reply2_text';
    return bot.sendMessage(id, 'Send the Reply 2 text.');
  }
  if (action === 'reply2_img1') {
    state.waiting = 'reply2_img1';
    return bot.sendMessage(id, 'Send Reply 2 Image 1.');
  }
  if (action === 'reply2_img2') {
    state.waiting = 'reply2_img2';
    return bot.sendMessage(id, 'Send Reply 2 Image 2.');
  }
  if (action === 'reply2_clear_img1') {
    state.reply2.image1 = null;
    return bot.sendMessage(id, '✅ Reply 2 Image 1 cleared.');
  }
  if (action === 'reply2_clear_img2') {
    state.reply2.image2 = null;
    return bot.sendMessage(id, '✅ Reply 2 Image 2 cleared.');
  }
});

console.log(`Bot running on port ${PORT}; fixed reply delay = ${DELAY} ms`);
