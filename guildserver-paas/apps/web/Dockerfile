FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY turbo.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages/database/package*.json ./packages/database/

# Install all dependencies
RUN npm ci

# Copy source code
COPY apps/web ./apps/web
COPY packages/database ./packages/database

# Build the application
RUN npm run build --workspace=@guildserver/web

EXPOSE 3000

CMD ["npm", "start", "--workspace=@guildserver/web"]