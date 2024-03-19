use napi::bindgen_prelude::Buffer;
use rsa::{Pkcs1v15Encrypt, RsaPrivateKey, RsaPublicKey};
use rsa::pkcs8::DecodePrivateKey;
use base64ct::{Base64, Encoding};

static MAX_TOKEN_PART_SIZE: usize = 128;


pub struct TokenEncryption {
    pub private_key: RsaPrivateKey,
    pub public_key: RsaPublicKey,
}

impl TokenEncryption {
    pub fn new(private_key_data: Vec<u8>) -> Self {
        let data = String::from_utf8(private_key_data).unwrap();
        let private_key = RsaPrivateKey::from_pkcs8_pem(data.as_str()).unwrap();
        let public_key = private_key.to_public_key();
        TokenEncryption { private_key, public_key }
    }
}
 
#[napi(js_name = "TokenEncryption")]
pub struct JsTokenEncryption {
  inner: TokenEncryption,
}
 
#[napi]
impl JsTokenEncryption {
  #[napi(constructor)]
  pub fn new(private_key_data: Buffer) -> Self {
    let buf: Vec<u8> = private_key_data.into();
    JsTokenEncryption { inner: TokenEncryption::new(buf) }
  }

  #[napi]
  pub fn decrypt(&self, parts: Vec<String>) -> String {
    let mut result = String::new();

    for v in parts {
        result += &self.decrypt_value(v);
    }
    result
  }

  pub fn decrypt_value(&self, value: String) -> String {
    if let Ok(raw_value) = Base64::decode_vec(&value) {
        if let Ok(decrypted_value) = self.inner.private_key.decrypt(Pkcs1v15Encrypt, &raw_value) {
            if let Ok(utf8_value) = String::from_utf8(decrypted_value) {
                return utf8_value;
            }
        }
    }
    panic!("oh no!");
  }

  #[napi]
  pub fn encrypt(&self, input: String) -> Vec<String> {
    let mut rng = rand::thread_rng();
    let mut parts: Vec<String> = Vec::new();
    for part in input.into_bytes().chunks(MAX_TOKEN_PART_SIZE) {
      let encrypted = self.inner.public_key.encrypt(&mut rng, Pkcs1v15Encrypt, part).unwrap();
      let b64 = Base64::encode_string(encrypted.as_slice());
      parts.push(b64);
    }
    parts
  }
}
