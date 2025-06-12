#!/bin/sh
if [ ! -f /data/passkey.pem ]; then
    echo "Generating new passkey"
    apk add openssl; 
    openssl genpkey -out /data/passkey.pem -outform PEM -algorithm RSA -pkeyopt rsa_keygen_bits:4096
fi

chown -R 991:991 /synapse-data