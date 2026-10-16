FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_CACHE_DIR=/root/.cache/puppeteer \
    DEBIAN_FRONTEND=noninteractive

# Chrome/Puppeteer runtime dependencies + fonts + utilities.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    wget \
    && rm -rf /var/lib/apt/lists/* \
    && ldconfig \
    && test -e /usr/lib/x86_64-linux-gnu/libglib-2.0.so.0

WORKDIR /app

# Install application dependencies first for better Railway/Docker caching.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy the bot source.
COPY . .

# Keep WhatsApp/Puppeteer session data in a predictable writable location.
RUN mkdir -p /app/data /app/.wwebjs_auth /app/.wwebjs_cache \
    && chmod -R 777 /app/data /app/.wwebjs_auth /app/.wwebjs_cache

# Railway provides PORT when needed; the bot itself can run without exposing a port.
EXPOSE 3000

# Start the existing package.json start script (node src/index.js).
CMD ["npm", "start"]
