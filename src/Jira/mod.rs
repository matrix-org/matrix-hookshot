use napi::{Env, Error as NapiError, JsObject};
pub mod utils;
pub mod types;

pub fn get_module(env: Env) -> Result<JsObject, NapiError> {
  let mut root_module = env.create_object()?;
  let mut utils_module = env.create_object()?;
  utils_module.create_named_method("generate_jira_web_link_from_issue", utils::js_generate_jira_web_link_from_issue)?;
  root_module.set_named_property("utils", utils_module)?;
  Ok(root_module)
}