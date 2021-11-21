# Stage 0: Build the thing
# Need debian based image to build the native rust module
# as musl doesn't support cdylib
FROM node:16 AS builder

COPY . /src
WORKDIR /src

RUN apt update && apt install -y rustc cargo git
# RUN rustup-init -y --target x86_64-unknown-linux-gnu
ENV PATH="/root/.cargo/bin:${PATH}"


# will also build
RUN yarn --ignore-scripts
# Workaround for https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=998232#10
RUN CARGO_NET_GIT_FETCH_WITH_CLI=true yarn build:app:rs --target x86_64-unknown-linux-gnu

# Stage 1: The actual container
FROM node:16-alpine

COPY --from=builder /src/lib/ /bin/matrix-github/
COPY --from=builder /src/public/ /bin/matrix-github/public/
COPY --from=builder /src/package.json /bin/matrix-github/
COPY --from=builder /src/yarn.lock /bin/matrix-github/
WORKDIR /bin/matrix-github
RUN yarn --production

VOLUME /data
EXPOSE 9993
EXPOSE 7775

CMD ["node", "/bin/matrix-github/App/BridgeApp.js", "/data/config.yml", "/data/registration.yml"]
