# Backend Dockerfile
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for TypeScript)
RUN npm ci

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Verify build output exists
RUN ls -la /app/dist/ || (echo "ERROR: dist folder not found after build" && exit 1)
RUN test -f /app/dist/server.js || (echo "ERROR: server.js not found in dist folder" && exit 1)
RUN echo "Build successful - dist folder contents:" && ls -la /app/dist/

# Production stage
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy migration files from builder stage (for migrations if needed)
COPY --from=builder /app/src/db/migrations ./src/db/migrations

# Verify files are copied correctly
RUN ls -la /app/ && echo "---" && ls -la /app/dist/ || (echo "ERROR: dist folder not found" && exit 1)
RUN test -f /app/dist/server.js || (echo "ERROR: server.js not found in /app/dist/" && exit 1)
RUN echo "✅ All files copied successfully"

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/server.js"]
