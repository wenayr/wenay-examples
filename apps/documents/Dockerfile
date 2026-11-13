FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81
WORKDIR /app
RUN apk add --no-cache python3
COPY package.json package-lock.json ./
RUN NODE_OPTIONS=--max-old-space-size=256 npm ci --no-audit --no-fund
COPY backend ./backend
COPY shared ./shared
COPY public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV SERVICE_PORT=8080 SERVICE_HOST=0.0.0.0 SERVICE_DATA_DIR=/data DOCUMENT_PYTHON=/usr/bin/python3 NODE_OPTIONS=--max-old-space-size=128
ARG APP_RELEASE=development
ENV APP_RELEASE=$APP_RELEASE
EXPOSE 8080
CMD ["node", "--import", "tsx", "backend/server.ts"]
