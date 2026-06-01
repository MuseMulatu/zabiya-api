FROM node:18-bullseye-slim

# Install OpenSSL (Required for Prisma)
RUN apt-get update && apt-get install -y openssl

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose the application port
EXPOSE 3000

# Start the server (adjust this if your start script is different, e.g., "npm run dev")
CMD ["npm", "start"]