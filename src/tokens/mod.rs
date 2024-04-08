use std::string::FromUtf8Error;

use base64ct::{Base64, Encoding};
use napi::bindgen_prelude::Buffer;
use napi::Error;
use rsa::pkcs8::DecodePrivateKey;
use rsa::{Pkcs1v15Encrypt, RsaPrivateKey, RsaPublicKey};

static MAX_TOKEN_PART_SIZE: usize = 128;

struct TokenEncryption {
    pub private_key: RsaPrivateKey,
    pub public_key: RsaPublicKey,
}

#[derive(Debug)]
#[allow(dead_code)]
enum TokenEncryptionError {
    FromUtf8(FromUtf8Error),
    PrivateKey(rsa::pkcs8::Error),
}

#[derive(Debug)]
#[allow(dead_code)]
enum DecryptError {
    Base64(base64ct::Error),
    Decryption(rsa::Error),
    FromUtf8(FromUtf8Error),
}

impl TokenEncryption {
    pub fn new(private_key_data: Vec<u8>) -> Result<Self, TokenEncryptionError> {
        let data = String::from_utf8(private_key_data).map_err(TokenEncryptionError::FromUtf8)?;
        let private_key = RsaPrivateKey::from_pkcs8_pem(data.as_str())
            .map_err(TokenEncryptionError::PrivateKey)?;
        let public_key = private_key.to_public_key();
        Ok(TokenEncryption {
            private_key,
            public_key,
        })
    }
}

#[napi(js_name = "TokenEncryption")]
pub struct JsTokenEncryption {
    inner: TokenEncryption,
}

#[napi]
impl JsTokenEncryption {
    #[napi(constructor)]
    pub fn new(private_key_data: Buffer) -> Result<Self, Error> {
        let buf: Vec<u8> = private_key_data.into();
        match TokenEncryption::new(buf) {
            Ok(inner) => Ok(JsTokenEncryption { inner }),
            Err(err) => Err(Error::new(
                napi::Status::GenericFailure,
                format!("Error reading private key: {:?}", err).to_string(),
            )),
        }
    }

    #[napi]
    pub fn decrypt(&self, parts: Vec<String>) -> Result<String, Error> {
        let mut result = String::new();

        for v in parts {
            match self.decrypt_value(v) {
                Ok(new_value) => {
                    result += &new_value;
                    Ok(())
                }
                Err(err) => Err(Error::new(
                    napi::Status::GenericFailure,
                    format!("Could not decrypt string: {:?}", err).to_string(),
                )),
            }?
        }
        Ok(result)
    }

    fn decrypt_value(&self, value: String) -> Result<String, DecryptError> {
        let raw_value = Base64::decode_vec(&value).map_err(DecryptError::Base64)?;
        let decrypted_value = self
            .inner
            .private_key
            .decrypt(Pkcs1v15Encrypt, &raw_value)
            .map_err(DecryptError::Decryption)?;
        let utf8_value = String::from_utf8(decrypted_value).map_err(DecryptError::FromUtf8)?;
        Ok(utf8_value)
    }

    #[napi]
    pub fn encrypt(&self, input: String) -> Result<Vec<String>, Error> {
        let mut rng = rand::thread_rng();
        let mut parts: Vec<String> = Vec::new();
        for part in input.into_bytes().chunks(MAX_TOKEN_PART_SIZE) {
            match self
                .inner
                .public_key
                .encrypt(&mut rng, Pkcs1v15Encrypt, part)
            {
                Ok(encrypted) => {
                    let b64 = Base64::encode_string(encrypted.as_slice());
                    parts.push(b64);
                    Ok(())
                }
                Err(err) => Err(Error::new(
                    napi::Status::GenericFailure,
                    format!("Could not encrypt string: {:?}", err).to_string(),
                )),
            }?
        }
        Ok(parts)
    }
}
