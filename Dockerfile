# Stage 0: Build the thing
# Need debian based image to build the native rust module
# as musl doesn't support cdylib
FROM node:18 AS builder

# We need rustup so we have a sensible rust version, the version packed with bullsye is too old
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# arm64 builds consume a lot of memory if `CARGO_NET_GIT_FETCH_WITH_CLI` is not
# set to true, so we expose it as a build-arg.
ARG CARGO_NET_GIT_FETCH_WITH_CLI=false
ENV CARGO_NET_GIT_FETCH_WITH_CLI=$CARGO_NET_GIT_FETCH_WITH_CLI

# Needed to build rust things for matrix-sdk-crypto-nodejs
# See https://github.com/matrix-org/matrix-rust-sdk-bindings/blob/main/crates/matrix-sdk-crypto-nodejs/release/Dockerfile.linux#L5-L6
RUN apt-get update && apt-get install -y build-essential cmake

# --- FOR TRACING
WORKDIR /src-sdk
RUN git clone https://github.com/matrix-org/matrix-rust-sdk.git
WORKDIR /src-sdk/matrix-rust-sdk/bindings/matrix-sdk-crypto-nodejs
RUN git checkout matrix-sdk-crypto-nodejs-v0.1.0-beta.6
RUN npm install --ignore-scripts
# Workaround for "dbg" profile builds not quite working
RUN sed -i 's/debug = 0/debug = 2/' ../../Cargo.toml
RUN npm run build -- --features tracing
RUN yarn link
# ---
WORKDIR /src

COPY package.json yarn.lock ./
RUN yarn config set yarn-offline-mirror /cache/yarn
RUN yarn --ignore-scripts --pure-lockfile --network-timeout 600000

COPY . ./

# Workaround: Need to install esbuild manually https://github.com/evanw/esbuild/issues/462#issuecomment-771328459
RUN node node_modules/esbuild/install.js
# --- FOR TRACING
RUN yarn link @matrix-org/matrix-sdk-crypto-nodejs
# ---
RUN yarn build


# Stage 1: The actual container
FROM node:18

# --- FOR PROFILING
RUN apt-get update && apt-get install -y valgrind
# ---

WORKDIR /bin/matrix-hookshot

COPY --from=builder /src/yarn.lock /src/package.json ./
COPY --from=builder /cache/yarn /cache/yarn
RUN yarn config set yarn-offline-mirror /cache/yarn

# --- FOR TRACING
COPY --from=builder /src-sdk/matrix-rust-sdk/bindings/matrix-sdk-crypto-nodejs /opt/matrix-sdk-crypto-nodejs
WORKDIR /opt/matrix-sdk-crypto-nodejs
RUN yarn link
WORKDIR /bin/matrix-hookshot
RUN yarn link @matrix-org/matrix-sdk-crypto-nodejs
# Ignore postinstall scripts to avoid downloading the non-debug version of the native Rust library
RUN yarn --network-timeout 600000 --production --pure-lockfile --ignore-scripts && yarn cache clean
# ---

COPY --from=builder /src/lib ./
COPY --from=builder /src/public ./public
COPY --from=builder /src/assets ./assets

VOLUME /data
EXPOSE 9993
EXPOSE 7775

# --- FOR TRACING
ENV MATRIX_LOG=debug
# ---
CMD ["bash", "-c", "exec valgrind --tool=massif --massif-out-file=/storage/massif.out.$(date +%F_%H:%M:%S) node /bin/matrix-hookshot/App/BridgeApp.js /data/config.yml /data/registration.yml"]
