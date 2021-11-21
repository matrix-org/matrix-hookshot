
use napi::{CallContext, Env, Error as NapiError, JsObject, JsUnknown};

use crate::Jira::types::{JiraIssue, JiraIssueLight};
use crate::Jira;


pub fn get_module(env: Env) -> Result<JsObject, NapiError> {
  let mut root_module = env.create_object()?;
  root_module.create_named_method("get_partial_body_for_jira_issue", get_partial_body_for_jira_issue)?;
  Ok(root_module)
}

/// Generate a URL for a given Jira Issue object.
#[js_function(1)]
pub fn get_partial_body_for_jira_issue(ctx: CallContext) -> Result<JsObject, NapiError> {
    let jira_issue: JiraIssue = ctx.env.from_js_value(ctx.get::<JsUnknown>(0)?)?;
    let light = JiraIssueLight {
        _self: jira_issue._self,
        key: jira_issue.key,
    };
    let mut body = ctx.env.create_object()?;
    let url = Jira::utils::generate_jira_web_link_from_issue(&light)?;
    body.set_named_property("external_url", ctx.env.create_string_from_std(url)?)?;

    let mut jira_issue_result = ctx.env.create_object()?;
    let mut jira_project = ctx.env.create_object()?;

    
    jira_issue_result.set_named_property("id", ctx.env.create_string_from_std(jira_issue.id)?)?;
    jira_issue_result.set_named_property("key", ctx.env.create_string_from_std(light.key)?)?;
    jira_issue_result.set_named_property("api_url", ctx.env.create_string_from_std(light._self)?)?;
    
    jira_project.set_named_property("id", ctx.env.create_string_from_std(jira_issue.fields.project.id)?)?;
    jira_project.set_named_property("key", ctx.env.create_string_from_std(jira_issue.fields.project.key)?)?;
    jira_project.set_named_property("api_url", ctx.env.create_string_from_std(jira_issue.fields.project._self)?)?;

    body.set_named_property("uk.half-shot.matrix-github.jira.issue", jira_issue_result)?;
    body.set_named_property("uk.half-shot.matrix-github.jira.project", jira_project)?;
    Ok(body)
}
