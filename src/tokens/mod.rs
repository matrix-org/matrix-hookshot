use std::string::FromUtf8Error;

use base64ct::{Base64, Encoding};
use napi::bindgen_prelude::Buffer;
use napi::Error;
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs8::DecodePrivateKey;
use rsa::{Oaep, Pkcs1v15Encrypt, RsaPrivateKey, RsaPublicKey};
use sha1::Sha1;

static MAX_TOKEN_PART_SIZE: usize = 128;

struct TokenEncryption {
    pub private_key: RsaPrivateKey,
    pub public_key: RsaPublicKey,
}

#[derive(Debug)]
#[allow(dead_code)]
enum TokenEncryptionError {
    FromUtf8(FromUtf8Error),
    UnknownFormat,
    PrivateKey8(rsa::pkcs8::Error),
    PrivateKey1(rsa::pkcs1::Error),
}

#[derive(Debug)]
#[allow(dead_code)]
enum DecryptError {
    Base64(base64ct::Error),
    Decryption(rsa::Error),
    FromUtf8(FromUtf8Error),
}

#[napi]
pub enum Algo {
    RSAOAEP,
    RSAPKCS1v15,
}

#[napi]
pub fn string_to_algo(algo_str: String) -> Result<Algo, Error> {
    match algo_str.as_str() {
        "rsa" => Ok(Algo::RSAOAEP),
        "rsa-pkcs1v15" => Ok(Algo::RSAPKCS1v15),
        _ => Err(Error::new(
            napi::Status::GenericFailure,
            "Unknown algorithm",
        )),
    }
}

impl TokenEncryption {
    pub fn new(private_key_data: Vec<u8>) -> Result<Self, TokenEncryptionError> {
        let data = String::from_utf8(private_key_data).map_err(TokenEncryptionError::FromUtf8)?;
        let private_key: RsaPrivateKey;
        if data.starts_with("-----BEGIN PRIVATE KEY-----") {
            private_key = RsaPrivateKey::from_pkcs8_pem(data.as_str())
                .map_err(TokenEncryptionError::PrivateKey8)?;
        } else if data.starts_with("-----BEGIN RSA PRIVATE KEY-----") {
            private_key = RsaPrivateKey::from_pkcs1_pem(data.as_str())
                .map_err(TokenEncryptionError::PrivateKey1)?;
        } else {
            return Err(TokenEncryptionError::UnknownFormat);
        }
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
    pub fn decrypt(&self, parts: Vec<String>, algo: Algo) -> Result<String, Error> {
        let mut result = String::new();

        for v in parts {
            match self.decrypt_value(v, algo) {
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

    fn decrypt_value(&self, value: String, algo: Algo) -> Result<String, DecryptError> {
        let raw_value = Base64::decode_vec(&value).map_err(DecryptError::Base64)?;
        let decrypted_value = match algo {
            Algo::RSAOAEP => {
                let padding = Oaep::new::<Sha1>();
                self.inner
                    .private_key
                    .decrypt(padding, &raw_value)
                    .map_err(DecryptError::Decryption)
            }
            Algo::RSAPKCS1v15 => self
                .inner
                .private_key
                .decrypt(Pkcs1v15Encrypt, &raw_value)
                .map_err(DecryptError::Decryption),
        }?;
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
