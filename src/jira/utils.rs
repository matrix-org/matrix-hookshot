use super::types::{JiraIssueLight, JiraVersion};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use url::Url;

/// Generate a URL for a given Jira Issue object.
#[napi(js_name = "generateJiraWeblinkFromIssue")]
pub fn js_generate_jira_web_link_from_issue(jira_issue: JiraIssueLight) -> Result<String> {
    generate_jira_web_link_from_issue(&jira_issue)
}

pub fn generate_jira_web_link_from_issue(jira_issue: &JiraIssueLight) -> Result<String> {
    let result = Url::parse(&jira_issue._self);
    match result {
        Ok(url) => Ok(format!(
            "{}://{}{}/browse/{}",
            url.scheme(),
            url.host_str().unwrap(),
            url.port()
                .map_or(String::new(), |port| format!(":{}", port)),
            jira_issue.key
        )),
        Err(err) => Err(Error::new(Status::Unknown, err.to_string())),
    }
}

/// Generate a URL for a given Jira Version object.
#[napi(js_name = "generateJiraWeblinkFromVersion")]
pub fn js_generate_jira_web_link_from_version(jira_version: JiraVersion) -> Result<String> {
    generate_jira_web_link_from_version(&jira_version)
}

pub fn generate_jira_web_link_from_version(jira_version: &JiraVersion) -> Result<String> {
    let result = Url::parse(&jira_version._self);
    match result {
        Ok(url) => Ok(format!(
            "{}://{}{}/projects/{}/versions/{}",
            url.scheme(),
            url.host_str().unwrap(),
            url.port()
                .map_or(String::new(), |port| format!(":{}", port)),
            jira_version.project_id,
            jira_version.id
        )),
        Err(err) => Err(Error::new(Status::Unknown, err.to_string())),
    }
}
