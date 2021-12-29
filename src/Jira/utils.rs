use super::types::JiraIssueLight;
use napi_derive::napi;
use napi::bindgen_prelude::*;
use url::Url;

/// Generate a URL for a given Jira Issue object.
#[napi(js_name="generateJiraWeblinkFromIssue")]
pub fn js_generate_jira_web_link_from_issue(jira_issue: JiraIssueLight) -> Result<String> {
    return generate_jira_web_link_from_issue(&jira_issue);
}

pub fn generate_jira_web_link_from_issue(jira_issue: &JiraIssueLight) -> Result<String> {
    let result = Url::parse(&jira_issue._self);
    match result {
        Ok(url) => Ok(format!(
            "{}://{}/browse/{}",
            url.scheme(),
            url.host_str().unwrap(),
            jira_issue.key
        )),
        Err(err) => Err(Error::new(Status::Unknown, err.to_string())),
    }
}
