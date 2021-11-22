use super::types::JiraIssueLight;
use napi::{CallContext, Error as NapiError, JsString, JsUnknown, Status};
use url::Url;

/// Generate a URL for a given Jira Issue object.
#[js_function(1)]
pub fn js_generate_jira_web_link_from_issue(ctx: CallContext) -> Result<JsString, NapiError> {
    let jira_issue: JiraIssueLight = ctx.env.from_js_value(ctx.get::<JsUnknown>(0)?)?;
    match generate_jira_web_link_from_issue(&jira_issue) {
        Ok(url) => ctx.env.create_string_from_std(url),
        Err(err) => Err(NapiError::new(Status::Unknown, err.to_string())),
    }
}

/// Generate a URL for a given Jira Issue object.
pub fn generate_jira_web_link_from_issue(jira_issue: &JiraIssueLight) -> Result<String, NapiError> {
    let result = Url::parse(&jira_issue._self);
    match result {
        Ok(url) => Ok(format!(
            "{}://{}/browse/{}",
            url.scheme(),
            url.host_str().unwrap(),
            jira_issue.key
        )),
        Err(err) => Err(NapiError::new(Status::Unknown, err.to_string())),
    }
}
