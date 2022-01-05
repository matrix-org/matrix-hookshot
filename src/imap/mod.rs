use std::net::TcpStream;

use imap::Session;
use native_tls::TlsStream;

extern crate imap;
extern crate native_tls;

struct ImapClient {
    pub domain: String,
    pub port: Option<u32>,
    pub session: Option<Session<TlsStream<TcpStream>>>,
}

#[napi(js_name = "ImapClient")]
struct JsImapClient {
    inner: ImapClient,
}

#[napi]
impl JsImapClient {
    #[napi(constructor)]
    pub fn new(domain: String, port: Option<u32>) -> Self {
        JsImapClient {
            inner: ImapClient {
                domain: domain,
                port: port,
                session: None,
            },
        }
    }

    /// Class method
    #[napi]
    #[allow(dead_code)]
    pub fn connect(&mut self, username: String, password: String) -> napi::Result<()> {
        let domain_str = self.inner.domain.as_str();
        let tls = native_tls::TlsConnector::builder().build().unwrap();
        let port: u16 = self.inner.port.unwrap_or(993).try_into().map_err(|e| {
            napi::Error::new(
                napi::Status::InvalidArg,
                format!("Error when converting port '{}'", e).to_string(),
            )
        })?;

        // we pass in the domain twice to check that the server's TLS
        // certificate is valid for the domain we're connecting to.
        let client = imap::connect((domain_str, port), domain_str, &tls).unwrap();

        // the client we have here is unauthenticated.
        // to do anything useful with the e-mails, we need to log in
        let session = client.login(username, password).map_err(|e| {
            napi::Error::new(
                napi::Status::InvalidArg,
                format!("Error when converting port '{}'", e.0).to_string(),
            )
        })?;
        self.inner.session = Some(session);
        Ok(())
    }
}
