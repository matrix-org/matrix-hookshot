# Stage 0: Build the thing
# Need debian based image to build the native rust module
# as musl doesn't support cdylib
FROM node:16 AS builder

COPY . /src
WORKDIR /src

# We need rustup so we have a sensible rust version, the version packed with bullsye is too old
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Needed to build rust things for matrix-sdk-crypto-nodejs
# See https://github.com/matrix-org/matrix-rust-sdk-bindings/blob/main/crates/matrix-sdk-crypto-nodejs/release/Dockerfile.linux#L5-L6
RUN apt-get update && apt-get install -y build-essential cmake

# Workaround: Need to install esbuild manually https://github.com/evanw/esbuild/issues/462#issuecomment-771328459
RUN yarn --ignore-scripts --pure-lockfile
RUN node node_modules/esbuild/install.js
RUN yarn build


# Stage 1: The actual container
FROM node:16-slim

COPY --from=builder /src/lib/ /bin/matrix-hookshot/
COPY --from=builder /src/public/ /bin/matrix-hookshot/public/
COPY --from=builder /src/package.json /bin/matrix-hookshot/
COPY --from=builder /src/yarn.lock /bin/matrix-hookshot/
WORKDIR /bin/matrix-hookshot

# --ignore-scripts so we don't try to build
RUN yarn --ignore-scripts --production --pure-lockfile && yarn cache clean

# Copy rust bindings for crypto, since we built them in the previous step.
COPY --from=builder /src/node_modules/@turt2live/matrix-sdk-crypto-nodejs /bin/matrix-hookshot/node_modules/@turt2live/matrix-sdk-crypto-nodejs

VOLUME /data
EXPOSE 9993
EXPOSE 7775

CMD ["node", "/bin/matrix-hookshot/App/BridgeApp.js", "/data/config.yml", "/data/registration.yml"]
