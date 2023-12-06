# Stage 0: Build the thing
# Need debian based image to build the native rust module
# as musl doesn't support cdylib
FROM node:20-slim AS builder

# Needed to build rust things for matrix-sdk-crypto-nodejs
# See https://github.com/matrix-org/matrix-rust-sdk-bindings/blob/main/crates/matrix-sdk-crypto-nodejs/release/Dockerfile.linux#L5-L6
RUN apt-get update && apt-get install -y build-essential cmake curl

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# arm64 builds consume a lot of memory if `CARGO_NET_GIT_FETCH_WITH_CLI` is not
# set to true, so we expose it as a build-arg.
ARG CARGO_NET_GIT_FETCH_WITH_CLI=false
ENV CARGO_NET_GIT_FETCH_WITH_CLI=$CARGO_NET_GIT_FETCH_WITH_CLI


WORKDIR /src

COPY package.json yarn.lock ./
RUN yarn config set yarn-offline-mirror /cache/yarn
RUN yarn --ignore-scripts --pure-lockfile --network-timeout 600000

COPY . ./

# Workaround: Need to install esbuild manually https://github.com/evanw/esbuild/issues/462#issuecomment-771328459
RUN node node_modules/esbuild/install.js
RUN yarn build


# Stage 1: The actual container
FROM node:20-slim

WORKDIR /bin/matrix-hookshot

COPY --from=builder /src/yarn.lock /src/package.json ./
COPY --from=builder /cache/yarn /cache/yarn
RUN yarn config set yarn-offline-mirror /cache/yarn

RUN yarn --network-timeout 600000 --production --pure-lockfile && yarn cache clean

COPY --from=builder /src/lib ./
COPY --from=builder /src/public ./public
COPY --from=builder /src/assets ./assets

VOLUME /data
EXPOSE 9993
EXPOSE 7775

CMD ["node", "/bin/matrix-hookshot/App/BridgeApp.js", "/data/config.yml", "/data/registration.yml"]
