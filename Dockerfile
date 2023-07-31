# syntax = docker/dockerfile:1.4

# The Debian version and version name must be in sync
ARG DEBIAN_VERSION=11
ARG DEBIAN_VERSION_NAME=bullseye
ARG RUSTC_VERSION=1.71.0
ARG ZIG_VERSION=0.10.1
ARG NODEJS_VERSION=18
ARG CARGO_ZIGBUILD_VERSION=0.16.12
# This needs to be kept in sync with the version in the package.json
ARG MATRIX_SDK_VERSION=0.1.0-beta.6

# Stage 1: Build the native rust module and the frontend assets
FROM --platform=${BUILDPLATFORM} node:${NODEJS_VERSION}-${DEBIAN_VERSION_NAME} AS builder

ARG CARGO_ZIGBUILD_VERSION
ARG RUSTC_VERSION
ARG ZIG_VERSION
ARG TARGETPLATFORM

# We need rustup so we have a sensible rust version, the version packed with bullsye is too old
RUN curl --proto '=https' --tlsv1.2 -sSf  https://sh.rustup.rs | sh -s -- -y --default-toolchain "${RUSTC_VERSION}" --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

RUN rustup target add  \
  --toolchain "${RUSTC_VERSION}" \
  x86_64-unknown-linux-gnu \
  aarch64-unknown-linux-gnu

# Install zig and cargo-zigbuild, which are used by napi to cross-compile the native module
RUN \
  curl --proto '=https' --tlsv1.2 -sSf "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-$(uname -m)-${ZIG_VERSION}.tar.xz" | tar -J -x -C /usr/local && \
  ln -s "/usr/local/zig-linux-$(uname -m)-${ZIG_VERSION}/zig" /usr/local/bin/zig

RUN cargo install --locked cargo-zigbuild@=${CARGO_ZIGBUILD_VERSION}

WORKDIR /src

COPY package.json yarn.lock ./
RUN yarn config set yarn-offline-mirror /cache/yarn
RUN --mount=type=cache,target=/cache/yarn \
    yarn --ignore-scripts --pure-lockfile --network-timeout 600000

# Workaround: Need to install esbuild manually https://github.com/evanw/esbuild/issues/462#issuecomment-771328459
RUN node node_modules/esbuild/install.js

COPY . ./

RUN --mount=type=cache,target=/cache/yarn \
    sh ./scripts/docker-cross-env.sh "$TARGETPLATFORM" \
    yarn build


# Stage 2: Install the production dependencies
FROM --platform=${BUILDPLATFORM} node:${NODEJS_VERSION} AS deps

ARG TARGETPLATFORM
ARG MATRIX_SDK_VERSION

WORKDIR /src

COPY yarn.lock package.json scripts/docker-cross-env.sh scripts/docker-download-sdk.sh ./
RUN yarn config set yarn-offline-mirror /cache/yarn

RUN --mount=type=cache,target=/cache/yarn \
    sh ./docker-cross-env.sh "$TARGETPLATFORM" \
    yarn --ignore-scripts --pure-lockfile --network-timeout 600000 --production
# Workaround: the install script of the matrix-rust-sdk only installs for the current platform, not the target one
RUN sh ./docker-download-sdk.sh "$TARGETPLATFORM" "$MATRIX_SDK_VERSION"


# Stage 3: Build the final runtime image
FROM --platform=$TARGETPLATFORM gcr.io/distroless/nodejs${NODEJS_VERSION}-debian${DEBIAN_VERSION}:nonroot AS runtime

WORKDIR /bin/matrix-hookshot

COPY package.json ./package.json
COPY --from=builder /src/lib ./
COPY --from=builder /src/public ./public
COPY --from=builder /src/assets ./assets
COPY --from=deps /src/node_modules ./node_modules

VOLUME /data
EXPOSE 9993
EXPOSE 7775

CMD ["/bin/matrix-hookshot/App/BridgeApp.js", "/data/config.yml", "/data/registration.yml"]
