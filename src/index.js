import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
import fs from 'node:fs';
import path from 'node:path';

const { Client, LocalAuth, MessageMedia } = pkg;
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('BOT_TOKEN is missing. Add it in Railway Variables.'); process.exit(1); }

const DATA_DIR = path.resolve('data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SESSION_DIR = path.join(DATA_DIR, 'wa-session');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

const defaults = { autoReply:false, delayMs:10000, text:'Hello! Thanks for your message. We will reply soon.', reply2:'', reply2Image:null, image:null, voice:null, file:null, adminChatId:null, activeAccountId:null, accounts:[] };
function loadSettings() { try { const raw=JSON.parse(fs.readFileSync(SETTINGS_FILE,'utf8')); return {...defaults,...raw,accounts:Array.isArray(raw.accounts)?raw.accounts:[]}; } catch { return {...defaults}; } }
let settings=loadSettings();
function saveSettings(){ fs.writeFileSync(SETTINGS_FILE,JSON.stringify(settings,null,2)); }

const bot=new TelegramBot(BOT_TOKEN,{polling:true});
const pending=new Map();
const accounts=new Map();
let accountCounter=0;
function makeKeyboard(){
  const rows=[
    [{text:'📱 Add WhatsApp'},{text:'🚪 Logout WhatsApp'}],
    [{text:'📋 Accounts'},{text:'🤖 Auto Reply'}],
    [{text:'✍️ Set Text'},{text:'🖼️ Set Image'}],
    [{text:'🎙️ Set Voice'},{text:'📎 Set File'}],
    [{text:'🔄 Reply 2'},{text:'🖼️ Reply 2 Image'},{text:'📊 Status'}]
  ];
  const connected=settings.accounts.filter(a=>a.id);
  for(let i=0;i<connected.length;i+=2) rows.push(connected.slice(i,i+2).map(a=>({text:`📱 ${a.name}`})));
  return {reply_markup:{keyboard:rows,resize_keyboard:true}};
}
function statusText(){
  const lines=['WhatsApp Auto Reply Bot','',`Auto Reply: ${settings.autoReply?'🟢 ON':'🔴 OFF'}`,`Delay: ${Number(settings.delayMs)/1000} seconds`,`Text: ${settings.text?'✅ Set':'❌ Not set'}`,`Reply 2: ${settings.reply2?'✅ Set':'❌ Not set'}`,`Reply 2 Image: ${settings.reply2Image?'✅ Set':'❌ Not set'}`,`Image: ${settings.image?'✅ Set':'❌ Not set'}`,`Voice: ${settings.voice?'✅ Set':'❌ Not set'}`,`File: ${settings.file?'✅ Set':'❌ Not set'}`,'','WhatsApp accounts:'];
  if(!settings.accounts.length) lines.push('❌ No accounts added.');
  else for(const meta of settings.accounts){const s=accounts.get(meta.id); lines.push(`${meta.name}: ${s?.ready?'🟢 Connected':s?.initializing?'🟡 Starting':'🔴 Offline'}${settings.activeAccountId===meta.id?' ⭐':''}`);}
  return lines.join('\n');
}
function getActiveAccount(){
  if(settings.activeAccountId&&accounts.has(settings.activeAccountId)) return accounts.get(settings.activeAccountId);
  for(const meta of settings.accounts){const s=accounts.get(meta.id); if(s){settings.activeAccountId=meta.id;saveSettings();return s;}}
  return null;
}
async function sendQr(state,qr){ if(state.qrBusy||!settings.adminChatId)return; state.qrBusy=true; try{const dataUrl=await QRCode.toDataURL(qr,{margin:1,width:700}); await bot.sendPhoto(settings.adminChatId,Buffer.from(dataUrl.split(',')[1],'base64'),{caption:`📱 Scan this QR to connect ${state.name}.\n\nAfter scanning, wait for the connected message.`});}catch(e){console.error(`QR error (${state.id}):`,e?.message||e);}finally{setTimeout(()=>{state.qrBusy=false;},5000);} }

async function sendMediaToChat(state, chatId, filePath, type){
  if(!filePath || !fs.existsSync(filePath)) return false;
  const media=MessageMedia.fromFilePath(filePath);
  if(type==='voice') await state.client.sendMessage(chatId,media,{sendAudioAsVoice:true});
  else if(type==='file') await state.client.sendMessage(chatId,media,{sendMediaAsDocument:true});
  else await state.client.sendMessage(chatId,media);
  return true;
}

function createWhatsAppAccount(id,name){
  const state={id,name,client:null,ready:false,initializing:false,initialized:false,qrBusy:false,destroyed:false,messageCounts:new Map()};
  const client=new Client({authStrategy:new LocalAuth({clientId:id,dataPath:SESSION_DIR}),puppeteer:{executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true,protocolTimeout:120000,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-zygote','--disable-accelerated-2d-canvas','--disable-software-rasterizer']}});
  state.client=client;
  client.on('qr',qr=>{console.log(`WhatsApp QR received for ${name}`);sendQr(state,qr);});
  client.on('authenticated',()=>console.log(`WhatsApp authenticated: ${name}`));
  client.on('ready',async()=>{state.ready=true;state.initializing=false;state.initialized=true;console.log(`WhatsApp READY: ${name}`);if(settings.adminChatId) await bot.sendMessage(settings.adminChatId,`✅ ${name} connected successfully.`,makeKeyboard()).catch(()=>{});});
  client.on('auth_failure',m=>{state.ready=false;state.initializing=false;console.error(`WhatsApp auth failure (${name}):`,m);});
  client.on('disconnected',r=>{state.ready=false;state.initializing=false;state.initialized=false;console.log(`WhatsApp disconnected (${name}):`,r);});

  client.on('message',async msg=>{
    if(!settings.autoReply||msg.fromMe||msg.isStatus||!state.ready)return;
    const senderId=msg.from; const count=(state.messageCounts.get(senderId)||0)+1; state.messageCounts.set(senderId,count);
    try{
      await new Promise(r=>setTimeout(r,Number(settings.delayMs)||10000));
      if(count===1){
        if(settings.text) await msg.reply(settings.text);
        // IMPORTANT: media is sent with client.sendMessage(), not msg.reply(),
        // which avoids the "Data passed to get must include an id property" error.
        await sendMediaToChat(state,senderId,settings.image,'image');
        await sendMediaToChat(state,senderId,settings.voice,'voice');
        await sendMediaToChat(state,senderId,settings.file,'file');
      } else if(count===2){
        if(settings.reply2) await msg.reply(settings.reply2);
        await sendMediaToChat(state,senderId,settings.reply2Image,'image');
      }
    }catch(error){console.error(`Auto-reply error (${name}):`,error?.stack||error?.message||error);}
  });
  accounts.set(id,state); return state;
}
async function initializeAccount(state){if(!state||state.destroyed||state.ready||state.initializing||state.initialized)return;state.initializing=true;try{console.log(`Starting WhatsApp account: ${state.name}`);await state.client.initialize();state.initialized=true;}catch(e){console.error(`WhatsApp initialize error (${state.name}):`,e?.message||e);state.initialized=false;}finally{state.initializing=false;}}
function nextAccountId(){accountCounter++;let id=`account-${accountCounter}`;while(settings.accounts.some(a=>a.id===id)){accountCounter++;id=`account-${accountCounter}`;}return id;}
async function addWhatsAppAccount(chatId){const id=nextAccountId();const name=`WhatsApp ${settings.accounts.length+1}`;settings.accounts.push({id,name});settings.activeAccountId=id;settings.adminChatId=chatId;saveSettings();const state=createWhatsAppAccount(id,name);await bot.sendMessage(chatId,`⏳ Starting ${name}...\nQR code will be sent here when ready.`,makeKeyboard());initializeAccount(state);}
async function logoutAccount(state){if(!state)return{ok:false,message:'No WhatsApp account selected.'};state.destroyed=true;try{if(state.ready)await state.client.logout();}catch(e){console.error('Logout error:',e?.message||e);}try{await state.client.destroy();}catch(e){console.error('Destroy error:',e?.message||e);}accounts.delete(state.id);settings.accounts=settings.accounts.filter(a=>a.id!==state.id);if(settings.activeAccountId===state.id)settings.activeAccountId=settings.accounts.at(-1)?.id||null;saveSettings();try{fs.rmSync(path.join(SESSION_DIR,`session-${state.id}`),{recursive:true,force:true});}catch(e){console.error('Session cleanup error:',e?.message||e);}return{ok:true,message:`✅ ${state.name} logged out and removed.`};}
function setPending(chatId,type){pending.set(chatId,type);}

bot.onText(/^\/start$/,async msg=>{settings.adminChatId=msg.chat.id;saveSettings();await bot.sendMessage(msg.chat.id,statusText(),makeKeyboard());});

bot.on('message',async msg=>{
  const chatId=msg.chat.id; const waiting=pending.get(chatId); settings.adminChatId=chatId;
  try{
    if(waiting==='reply2Image'&&msg.photo?.length){const id=msg.photo.at(-1).file_id;const downloaded=await bot.downloadFile(id,MEDIA_DIR);const dest=path.join(MEDIA_DIR,'reply2-image.jpg');if(fs.existsSync(dest))fs.unlinkSync(dest);fs.renameSync(downloaded,dest);settings.reply2Image=dest;pending.delete(chatId);saveSettings();return bot.sendMessage(chatId,'✅ Reply 2 image saved.',makeKeyboard());}
    if(waiting==='reply2'){if(!msg.text)return bot.sendMessage(chatId,'❌ Reply 2 must be text. Please send a text message.',makeKeyboard());settings.reply2=msg.text;pending.delete(chatId);saveSettings();return bot.sendMessage(chatId,'✅ Reply 2 saved.',makeKeyboard());}
    if(waiting==='image'&&msg.photo?.length){const id=msg.photo.at(-1).file_id;const downloaded=await bot.downloadFile(id,MEDIA_DIR);const dest=path.join(MEDIA_DIR,'reply-image.jpg');if(fs.existsSync(dest))fs.unlinkSync(dest);fs.renameSync(downloaded,dest);settings.image=dest;pending.delete(chatId);saveSettings();return bot.sendMessage(chatId,'✅ Image saved.',makeKeyboard());}
    if(waiting==='voice'&&(msg.voice||msg.audio)){const id=msg.voice?.file_id||msg.audio?.file_id;const downloaded=await bot.downloadFile(id,MEDIA_DIR);const ext=path.extname(downloaded)||'.ogg';const dest=path.join(MEDIA_DIR,`reply-voice${ext}`);if(fs.existsSync(dest))fs.unlinkSync(dest);fs.renameSync(downloaded,dest);settings.voice=dest;pending.delete(chatId);saveSettings();return bot.sendMessage(chatId,'✅ Voice saved.',makeKeyboard());}
    if(waiting==='file'&&msg.document){const id=msg.document.file_id;const downloaded=await bot.downloadFile(id,MEDIA_DIR);const safe=path.basename(msg.document.file_name||path.basename(downloaded));const dest=path.join(MEDIA_DIR,`reply-file-${safe}`);if(fs.existsSync(dest))fs.unlinkSync(dest);fs.renameSync(downloaded,dest);settings.file=dest;pending.delete(chatId);saveSettings();return bot.sendMessage(chatId,'✅ File saved.',makeKeyboard());}
    if(!msg.text||msg.text.startsWith('/'))return;
    if(msg.text==='📱 Add WhatsApp')return addWhatsAppAccount(chatId);
    if(msg.text==='🚪 Logout WhatsApp'){const r=await logoutAccount(getActiveAccount());return bot.sendMessage(chatId,r.message,makeKeyboard());}
    if(msg.text==='📋 Accounts')return bot.sendMessage(chatId,statusText(),makeKeyboard());
    const selected=settings.accounts.find(a=>msg.text===`📱 ${a.name}`);if(selected){settings.activeAccountId=selected.id;saveSettings();return bot.sendMessage(chatId,`✅ Active account: ${selected.name}`,makeKeyboard());}
    if(msg.text==='🤖 Auto Reply'){settings.autoReply=!settings.autoReply;saveSettings();return bot.sendMessage(chatId,`Auto Reply: ${settings.autoReply?'🟢 ON':'🔴 OFF'}\nDelay: ${Number(settings.delayMs)/1000} seconds.`,makeKeyboard());}
    if(msg.text==='✍️ Set Text'){setPending(chatId,'text');return bot.sendMessage(chatId,'Send the text you want the bot to reply with.',makeKeyboard());}
    if(msg.text==='🖼️ Set Image'){setPending(chatId,'image');return bot.sendMessage(chatId,'Send an image here. It will be used as the auto-reply image.',makeKeyboard());}
    if(msg.text==='🎙️ Set Voice'){setPending(chatId,'voice');return bot.sendMessage(chatId,'Send a voice/audio file here.',makeKeyboard());}
    if(msg.text==='📎 Set File'){setPending(chatId,'file');return bot.sendMessage(chatId,'Send a document/file here.',makeKeyboard());}
    if(msg.text==='🖼️ Reply 2 Image'){setPending(chatId,'reply2Image');return bot.sendMessage(chatId,'Send the image for Reply 2.',makeKeyboard());}
    if(msg.text==='🔄 Reply 2'){setPending(chatId,'reply2');return bot.sendMessage(chatId,'Send the second auto-reply text now. It will be sent after Reply 1.',makeKeyboard());}
    if(msg.text==='📊 Status')return bot.sendMessage(chatId,statusText(),makeKeyboard());
    if(waiting==='text'){settings.text=msg.text;pending.delete(chatId);saveSettings();return bot.sendMessage(chatId,'✅ Auto-reply text saved.',makeKeyboard());}
  }catch(e){console.error('Telegram handler error:',e?.stack||e?.message||e);await bot.sendMessage(chatId,'❌ Operation failed. Check Railway logs.').catch(()=>{});}
});

for(const meta of settings.accounts){const m=String(meta.id).match(/^account-(\d+)$/);if(m)accountCounter=Math.max(accountCounter,Number(m[1]));const state=createWhatsAppAccount(meta.id,meta.name);await new Promise(r=>setTimeout(r,1000));initializeAccount(state);}
console.log('Telegram bot started.');
console.log('Waiting for Telegram /start...');
bot.on('polling_error',e=>console.error('Telegram polling error:',e?.message||e));
