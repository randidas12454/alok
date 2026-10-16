# Telegram WhatsApp Auto-Reply Bot — Final

## Required behavior
- Add WhatsApp button.
- Add WhatsApp opens two login methods: Number or QR.
- Number login accepts a complete international number with any country code, with or without `+`.
- QR login sends a QR image to Telegram.
- Reply 1: Text + Image + Voice + File.
- Reply 2: Text + Image + Voice + File.
- Default delay: 10 seconds before each reply set is sent.
- First incoming WhatsApp message from a sender triggers Reply 1.
- Second incoming WhatsApp message from that sender triggers Reply 2.
- Each configured item is sent independently, so one failed media item does not stop the others.
- Voice is sent as a WhatsApp voice message; File is sent as a document.
- Multiple WhatsApp accounts use separate LocalAuth sessions.

## Railway
1. Upload this project to GitHub.
2. Create a Railway service from the repo.
3. Add `BOT_TOKEN` in Railway Variables.
4. Deploy.
5. Send `/start` to the Telegram bot.

## Important
This uses `whatsapp-web.js` 1.34.7. Phone-number pairing is provided by its `pairWithPhoneNumber` option and `code` event.
