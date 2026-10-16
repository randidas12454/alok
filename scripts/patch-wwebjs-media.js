import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('node_modules/whatsapp-web.js/src/util/Injected/Utils.js');

if (!fs.existsSync(file)) {
  console.warn('[wwebjs patch] Utils.js not found; skipping media patch.');
  process.exit(0);
}

let source = fs.readFileSync(file, 'utf8');

if (source.includes('delete message.__x_id;')) {
  console.log('[wwebjs patch] media __x_id fix already present.');
  process.exit(0);
}

const markerRe = /await window\.Store\.(?:SendMessage\.)?addAndSendMsgToChat\(chat, message\);/;
const markerMatch = source.match(markerRe);
const markerIndex = markerMatch ? markerMatch.index : -1;
if (markerIndex === -1) {
  console.warn('[wwebjs patch] sendMessage marker not found; media patch was NOT applied.');
  process.exit(0);
}

const before = source.slice(0, markerIndex);
const messageStart = before.lastIndexOf('const message = {');
if (messageStart === -1) {
  console.warn('[wwebjs patch] message object not found; media patch was NOT applied.');
  process.exit(0);
}

// The outgoing message object is built immediately before addAndSendMsgToChat.
// WhatsApp Web 2026 media models expose __x_id, which can overwrite the real
// outgoing message id in whatsapp-web.js 1.34.7. Remove it before sending.
const patched = source.slice(0, markerIndex) +
  'delete message.__x_id;\n\n' +
  source.slice(markerIndex);

fs.writeFileSync(file, patched);
console.log('[wwebjs patch] Applied media __x_id collision fix.');
