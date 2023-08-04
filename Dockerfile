# syntax = docker/dockerfile:1.4

ARG DEBIAN_VERSION_NAME=bookworm
ARG RUSTC_VERSION=1.71.1
# XXX: zig v0.10.x has issues with building with the current napi CLI tool. This should be fixed in the
# next release of the napi CLI, which leverages cargo-zigbuild and does not have this issue.
ARG ZIG_VERSION=0.9.1
ARG NODEJS_VERSION=18.17.0

# Stage 1: Build the native rust module and the frontend assets
FROM --platform=${BUILDPLATFORM} docker.io/library/node:${NODEJS_VERSION}-${DEBIAN_VERSION_NAME} AS builder

# We need rustup so we have a sensible rust version, the version packed with bookworm is too old
ARG RUSTC_VERSION
RUN curl --proto '=https' --tlsv1.2 -sSf  https://sh.rustup.rs | sh -s -- -y --default-toolchain "${RUSTC_VERSION}" --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

RUN rustup target add  \
  --toolchain "${RUSTC_VERSION}" \
  x86_64-unknown-linux-gnu \
  aarch64-unknown-linux-gnu

# Install zig, which is then used by napi to cross-compile the native module
ARG ZIG_VERSION
RUN \
  curl --proto '=https' --tlsv1.2 -sSf "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-$(uname -m)-${ZIG_VERSION}.tar.xz" | tar -J -x -C /usr/local && \
  ln -s "/usr/local/zig-linux-$(uname -m)-${ZIG_VERSION}/zig" /usr/local/bin/zig

WORKDIR /src

COPY package.json yarn.lock ./
RUN yarn config set yarn-offline-mirror /cache/yarn
RUN --mount=type=cache,target=/cache/yarn \
    yarn --ignore-scripts --pure-lockfile --network-timeout 600000

# Workaround: Need to install esbuild manually https://github.com/evanw/esbuild/issues/462#issuecomment-771328459
RUN node node_modules/esbuild/install.js

COPY . ./

ARG TARGETPLATFORM
RUN --mount=type=cache,target=/cache/yarn \
    sh ./scripts/docker-cross-env.sh "$TARGETPLATFORM" \
    yarn build


# Stage 2: Install the production dependencies
FROM --platform=${BUILDPLATFORM} docker.io/library/node:${NODEJS_VERSION}-${DEBIAN_VERSION_NAME} AS deps

WORKDIR /src

COPY yarn.lock package.json scripts/docker-cross-env.sh ./
RUN yarn config set yarn-offline-mirror /cache/yarn

ARG TARGETPLATFORM
RUN --mount=type=cache,target=/cache/yarn \
    sh ./docker-cross-env.sh "$TARGETPLATFORM" \
    yarn --pure-lockfile --network-timeout 600000 --production


# Stage 3: Build the final runtime image
FROM --platform=$TARGETPLATFORM docker.io/library/node:${NODEJS_VERSION}-${DEBIAN_VERSION_NAME}-slim AS runtime

WORKDIR /bin/matrix-hookshot

COPY package.json ./package.json
COPY --from=builder /src/lib ./
COPY --from=builder /src/public ./public
COPY --from=builder /src/assets ./assets
COPY --from=deps /src/node_modules ./node_modules

VOLUME /data
EXPOSE 9993
EXPOSE 7775

CMD ["node", "/bin/matrix-hookshot/App/BridgeApp.js", "/data/config.yml", "/data/registration.yml"]
