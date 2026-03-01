FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY turbo.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/database/package*.json ./packages/database/

# Install all dependencies
RUN npm ci

# Copy source code
COPY apps/api ./apps/api
COPY packages/database ./packages/database

# Build the application
RUN npm run build --workspace=@guildserver/api

EXPOSE 4000

CMD ["npm", "start", "--workspace=@guildserver/api"]