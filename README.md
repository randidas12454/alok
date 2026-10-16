# Telegram → WhatsApp Auto Reply Bot

This starter project provides:
- Telegram control menu
- Add WhatsApp via a QR session
- Auto Reply ON/OFF
- Set Text
- Set Image
- Set Voice
- Set File
- Fixed 10-second delay before an automatic reply

## Setup

1. Install Node.js 20+.
2. Create a Telegram bot with @BotFather and copy its token.
3. Copy `.env.example` to `.env`.
4. Put the token in `.env`.
5. Run:

```bash
npm install
npm start
```

6. Open your Telegram bot and send `/start`.
7. Choose `📱 Add WhatsApp` and scan the QR from WhatsApp > Linked devices.
8. Turn on `🤖 Auto Reply`.
9. Configure Text/Image/Voice/File.

## Notes

- The WhatsApp session is stored locally under `data/wa-session`.
- The reply delay is fixed at 10,000 ms.
- Use this only for contacts/messages where automated replies are appropriate and permitted. Do not use it for unsolicited bulk messaging or to evade platform restrictions.
- This is a starter implementation, not a production-grade multi-user SaaS.
