# Stage 0: Build the thing
FROM node:14-alpine AS builder

COPY . /src
WORKDIR /src

# will also build
RUN yarn 

# Stage 1: The actual container
FROM node:14-alpine

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
