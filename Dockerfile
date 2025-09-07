# Use latest Node.js LTS
FROM node:lts-bullseye

# Install dependencies (ffmpeg, imagemagick, webp)
RUN apt-get update && \
    apt-get install -y \
        ffmpeg \
        imagemagick \
        webp && \
    apt-get upgrade -y && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json first for dependency installation
COPY package.json ./

# Install all dependencies including qrcode-terminal
RUN npm install && npm install qrcode-terminal

# Copy the rest of the bot files
COPY . .

# Expose port (Koyeb/Heroku needs it)
EXPOSE 5000

# Start the bot
CMD ["npm", "start"]
