# CaseLight on Railway (or any container host).
# poppler-utils renders and reads PDF pages; tesseract-ocr reads the scanned ones.
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "--no-warnings", "src/server.js"]
