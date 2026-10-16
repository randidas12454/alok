# Telegram -> WhatsApp Auto Reply Bot (fixed)

This package is a fixed replacement for the current repository.

## Main fix
Media replies now use `client.sendMessage(chatId, MessageMedia, options)` instead of `msg.reply(MessageMedia)`. This fixes the WhatsApp Web.js error seen in Railway: `Data passed to get must include an id property ... got undefined`.

Image, voice/audio, file/document, and Reply 2 image are handled separately.

## Railway
Set `BOT_TOKEN` in Railway Variables and deploy with the included Dockerfile. Keep one replica/container for a WhatsApp session.
