FROM node:22-bookworm-slim
ENV NODE_ENV=production
ARG YTDLP_VERSION=2026.11.23
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl python3 python3-venv build-essential pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    ffmpeg libreoffice-core libreoffice-writer libreoffice-calc imagemagick poppler-utils fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]==${YTDLP_VERSION}" \
    && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
    && yt-dlp --version && ffmpeg -version
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe YTDLP_PATH=/usr/local/bin/yt-dlp
EXPOSE 3000
CMD ["node", "index.js"]
