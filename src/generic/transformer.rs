
use napi::bindgen_prelude::*;
use napi_derive::napi;
use boa_engine::{
    Context,
    Source, realm::Realm
};

#[napi]
pub fn load_script(code: String) -> Result<External<Context<'static>>> {
    // Unwrap!
    let script = Source::from_bytes(&code);

    // Check it's valid
    let mut context = Context::default();
    match context.eval(script) {
        Ok(_) => Ok(External::new(context)),
        Err(err) => Err(Error::new(Status::Unknown, format!("Failed to load script: {:?}", err.to_string()))),
    }
}

pub fn run_script(mut context: External<Context<'static>>) {
    context.eval();
}