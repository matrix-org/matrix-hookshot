import { Algo, TokenEncryption } from "../../src/libRs";
import { RSAKeyPairOptions, generateKeyPair, publicEncrypt } from "node:crypto";
import { expect } from "chai";

describe("TokenEncryption", () => {
    let keyPromise: Promise<Buffer>;
    let keyPromisePKCS1: Promise<Buffer>;
    async function createTokenEncryption() {
        return new TokenEncryption(await keyPromise);
    }

    async function legacyEncryptFunction(token: string) {
        const MAX_TOKEN_PART_SIZE = 128;
        const tokenParts: string[] = [];
        let tokenSource = token;
        while (tokenSource && tokenSource.length > 0) {
            const part = tokenSource.slice(0, MAX_TOKEN_PART_SIZE);
            tokenSource = tokenSource.substring(MAX_TOKEN_PART_SIZE);
            tokenParts.push(publicEncrypt(await keyPromise, Buffer.from(part)).toString("base64"));
        }
        return tokenParts;
    }
    
    before('generate RSA key', () => {
        // Generate this once since it will take an age.
        keyPromise = new Promise<Buffer>((resolve, reject) => generateKeyPair("rsa", {
            // Deliberately shorter length to speed up test
            modulusLength: 2048,
            privateKeyEncoding: {
                type: "pkcs8",
                format: "pem",
            },
            publicKeyEncoding: {
                format: "pem",
                type: "pkcs1",
            }
        } satisfies RSAKeyPairOptions<"pem", "pem">, (err, _, privateKey) => {
            if (err) { reject(err) } else { resolve(Buffer.from(privateKey)) }
        }));
        keyPromisePKCS1 = new Promise<Buffer>((resolve, reject) => generateKeyPair("rsa", {
            // Deliberately shorter length to speed up test
            modulusLength: 2048,
            privateKeyEncoding: {
                type: "pkcs1",
                format: "pem",
            },
            publicKeyEncoding: {
                format: "pem",
                type: "pkcs1",
            }
        } satisfies RSAKeyPairOptions<"pem", "pem">, (err, _, privateKey) => {
            if (err) { reject(err) } else { resolve(Buffer.from(privateKey)) }
        }));

    }, );

    it('should be able to encrypt a string into a single part', async() => {
        const tokenEncryption = await createTokenEncryption();
        const result = tokenEncryption.encrypt('hello world');
        expect(result).to.have.lengthOf(1);
    });

    it('should be able to decrypt from a single part into a string', async() => {
        const tokenEncryption = await createTokenEncryption();
        const value = tokenEncryption.encrypt('hello world');
        const result = tokenEncryption.decrypt(value, Algo.RSAPKCS1v15);
        expect(result).to.equal('hello world');
    });

    it('should be able to decrypt from many parts into string', async() => {
        const plaintext = 'This is a very long string that needs to be encoded into multiple parts in order for us to store it properly. This ' +
        ' should end up as multiple encrypted values in base64.';
        const tokenEncryption = await createTokenEncryption();
        const value = tokenEncryption.encrypt(plaintext);
        expect(value).to.have.lengthOf(2);
        const result = tokenEncryption.decrypt(value, Algo.RSAPKCS1v15);
        expect(result).to.equal(plaintext);
    });

    it('should support pkcs1 format keys', async() => {
        const tokenEncryption = new TokenEncryption(await keyPromisePKCS1);
        const result = tokenEncryption.encrypt('hello world');
        expect(result).to.have.lengthOf(1);
    });

    it('should be to decrypt a string from the old crypto implementation', async() => {
        const legacyString = await legacyEncryptFunction('hello world');
        const tokenEncryption = await createTokenEncryption();
        expect(tokenEncryption.decrypt(legacyString, Algo.RSAOAEP)).to.equal('hello world');
    });
});
