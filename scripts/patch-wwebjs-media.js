import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(
  'node_modules/whatsapp-web.js/src/util/Injected/Utils.js'
);

if (!fs.existsSync(file)) {
  console.warn('[wwebjs patch] Utils.js not found; skipping media patch.');
  process.exit(0);
}

let source = fs.readFileSync(file, 'utf8');

if (source.includes('delete message.__x_id;')) {
  console.log('[wwebjs patch] media __x_id fix already present.');
  process.exit(0);
}

const patterns = [
  /await window\.Store\.(?:SendMessage\.)?addAndSendMsgToChat\(chat, message\);/,
  /window\.Store\.(?:SendMessage\.)?addAndSendMsgToChat\(chat, message\);/
];

let markerIndex = -1;

for (const pattern of patterns) {
  const match = source.match(pattern);

  if (match) {
    markerIndex = match.index;
    break;
  }
}

if (markerIndex !== -1) {
  const before = source.slice(0, markerIndex);
  const messageStart = before.lastIndexOf('const message = {');

  if (messageStart !== -1) {
    source =
      source.slice(0, markerIndex) +
      'delete message.__x_id;\n\n' +
      source.slice(markerIndex);

    fs.writeFileSync(file, source);

    console.log(
      '[wwebjs patch] Applied media __x_id collision fix.'
    );

    process.exit(0);
  }
}

console.warn(
  '[wwebjs patch] Compatible sendMessage marker not found; ' +
  'media patch was not applied. Continuing build.'
);

process.exit(0);