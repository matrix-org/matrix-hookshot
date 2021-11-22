use napi::{Env, Error as NapiError, JsObject};
mod FormatUtil;
mod Jira;

#[macro_use]
extern crate napi_derive;

#[macro_use]
extern crate serde_derive;

#[module_exports]
fn init(mut exports: JsObject, env: Env) -> Result<(), NapiError> {
    exports.set_named_property("jira", Jira::get_module(env)?)?;
    exports.set_named_property("format_util", FormatUtil::get_module(env)?)?;
    Ok(())
}
