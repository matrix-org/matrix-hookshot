use napi::{Env, Error as NapiError, JsObject};
pub mod web;

pub fn get_module(env: Env) -> Result<JsObject, NapiError> {
    let mut root_module = env.create_object()?;
    root_module.create_named_method(
        "start_server",
        web::start_server,
    )?;
    Ok(root_module)
}
