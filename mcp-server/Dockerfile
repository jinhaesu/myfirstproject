FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY *.mjs ./
EXPOSE 3002
CMD ["node", "server.mjs"]
