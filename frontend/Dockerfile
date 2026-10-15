FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
FROM node:22-slim AS browser-tests
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund && npx playwright install --with-deps chromium
COPY . .
RUN npm run build
USER node
CMD ["npm", "test"]

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/pharmacy/browser /usr/share/nginx/html
