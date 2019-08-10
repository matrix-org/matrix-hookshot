# Stage 0: Build the thing
FROM node:12-alpine AS builder

COPY . /src
WORKDIR /src

RUN npm install
RUN npm run build

# Stage 1: The actual container
FROM node:12-alpine

COPY --from=builder /src/lib/ /bin/matrix-github/
COPY --from=builder /src/package*.json /bin/matrix-github/
WORKDIR /bin/matrix-github
RUN npm install --production

VOLUME /data
EXPOSE 9993
EXPOSE 7775

CMD ["node", "/bin/matrix-github/App/BridgeApp.js", "/data/config.yml", "/data/registration.yml"]
