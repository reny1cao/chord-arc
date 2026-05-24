FROM node:20-bookworm-slim AS deps

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
COPY .yarn/plugins ./.yarn/plugins
COPY packages/daemon/package.json ./packages/daemon/package.json
COPY packages/hardhat/package.json ./packages/hardhat/package.json
COPY packages/nextjs/package.json ./packages/nextjs/package.json

RUN node .yarn/releases/yarn-3.2.3.cjs install --immutable

FROM deps AS build

ARG NEXT_PUBLIC_CHORD_NETWORK=arc
ARG NEXT_PUBLIC_ARC_TESTNET_RPC_URL
ARG NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID
ARG NEXT_PUBLIC_CHORD_AGENTS_REGISTRY_URL
ARG KIMI_API_KEY

ENV NEXT_PUBLIC_CHORD_NETWORK=$NEXT_PUBLIC_CHORD_NETWORK
ENV NEXT_PUBLIC_ARC_TESTNET_RPC_URL=$NEXT_PUBLIC_ARC_TESTNET_RPC_URL
ENV NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID
ENV NEXT_PUBLIC_CHORD_AGENTS_REGISTRY_URL=$NEXT_PUBLIC_CHORD_AGENTS_REGISTRY_URL
ENV KIMI_API_KEY=$KIMI_API_KEY

COPY . .
RUN node .yarn/releases/yarn-3.2.3.cjs workspace @chord/nextjs build

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN corepack enable

COPY --from=build /app /app

EXPOSE 3000
CMD ["sh", "-lc", "node .yarn/releases/yarn-3.2.3.cjs workspace @chord/nextjs serve -H 0.0.0.0 -p ${PORT:-3000}"]
