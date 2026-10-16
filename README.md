# Telegram → WhatsApp Auto Reply Bot

Fresh Railway-ready starter.

## Features
- Telegram control buttons
- WhatsApp QR login sent to Telegram
- Auto Reply ON/OFF
- Set text reply
- Set image, voice, or file reply
- Fixed 10-second reply delay
- Local WhatsApp session under `data/wa-session`

## Railway
Add these Variables:
- `BOT_TOKEN` = your Telegram bot token

Then deploy using the Dockerfile.

Important: Railway's normal filesystem is ephemeral. Add a Railway Volume mounted at `/app/data` if you want the WhatsApp login session to survive redeploys/restarts.

Use only for contacts/messages where automated replies are appropriate and permitted. Do not use for unsolicited bulk messaging or to evade WhatsApp restrictions.
