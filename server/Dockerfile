FROM node:20-alpine
# pg_dump for the in-app database backups (Settings › Backups). Pinned to 16 to match the
# postgres:16-alpine server so dumps restore cleanly with the matching pg_restore.
RUN apk add --no-cache postgresql16-client
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "src/boot.js"]
