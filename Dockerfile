# Stage 0: Build the thing
# Need debian based image to make node happy
FROM node:16 AS builder

COPY . /src
WORKDIR /src

RUN apk add rustup
RUN rustup-init -y --target x86_64-unknown-linux-gnu
ENV PATH="/root/.cargo/bin:${PATH}"


# will also build
RUN yarn

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
