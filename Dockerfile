# The whole source tree ships: pages read RATIONALE.md, python/ and test/fixtures/ at runtime,
# and /oncoprint-lab/cli runs scripts/*.ts with node.
FROM node:22-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# No .git in the build context, so next.config.mjs reads the commit from here
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT

RUN npm run build && chown -R node:node .next

ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
