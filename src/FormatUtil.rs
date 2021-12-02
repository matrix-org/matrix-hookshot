use crate::Jira;
use crate::Jira::types::{JiraIssue, JiraIssueLight};
use contrast;
use md5::{Md5, Digest};
use napi::{CallContext, Env, Error as NapiError, JsObject, JsUnknown, Status, JsString};
use rgb::RGB;
use std::fmt::Write;

#[derive(Serialize, Debug, Deserialize)]
struct IssueLabelDetail {
    color: Option<String>,
    name: String,
    description: Option<String>,
}

pub fn get_module(env: Env) -> Result<JsObject, NapiError> {
    let mut root_module = env.create_object()?;
    root_module.create_named_method(
        "get_partial_body_for_jira_issue",
        get_partial_body_for_jira_issue,
    )?;
    root_module.create_named_method("format_labels", format_labels)?;
    root_module.create_named_method("hash_id", hash_id)?;
    Ok(root_module)
}

fn parse_rgb(input_color: String) -> Result<rgb::RGB8, NapiError> {
    let chunk_size;
    let color;
    if input_color.starts_with('#') {
        let mut chars = input_color.chars();
        chars.next();
        color = String::from_iter(chars);
    } else {
        color = input_color;
    }
    match color.len() {
        6 => {
            chunk_size = 2;
        }
        3 => {
            chunk_size = 1;
        }
        _ => {
            return Err(NapiError::new(
                Status::InvalidArg,
                format!("color '{}' is invalid", color).to_string(),
            ));
        }
    }
    let rgb = color
        .as_bytes()
        .chunks(chunk_size)
        .map(std::str::from_utf8)
        .collect::<Result<Vec<&str>, _>>()
        .unwrap();
    let r = u8::from_str_radix(rgb[0], 16).unwrap();
    let g = u8::from_str_radix(rgb[1], 16).unwrap();
    let b = u8::from_str_radix(rgb[2], 16).unwrap();
    Ok(RGB::new(r, g, b))
}

#[js_function(1)]
pub fn format_labels(ctx: CallContext) -> Result<JsObject, NapiError> {
    let array: JsObject = ctx.get::<JsObject>(0)?;
    if array.is_array()? != true {
        return Err(NapiError::new(
            Status::InvalidArg,
            "labels is not an array".to_string(),
        ));
    }
    let mut plain = String::new();
    let mut html = String::new();
    let mut i = 0;
    while array.has_element(i)? {
        let label: IssueLabelDetail = ctx
            .env
            .from_js_value(array.get_element_unchecked::<JsUnknown>(i)?)?;

        if i != 0 {
            plain.push_str(", ");
            html.push_str(" ");
        }
        plain.push_str(&label.name);

        // HTML
        html.push_str("<span");
        match label.color {
            Some(color) => {
                write!(html, " data-mx-bg-color=\"#{}\"", color).unwrap();
                // Determine the constrast
                let color_rgb = parse_rgb(color)?;
                let contrast_color;
                if contrast::contrast::<u8, f32>(color_rgb, RGB::new(0, 0, 0)) > 4.5 {
                    contrast_color = "#000000";
                } else {
                    contrast_color = "#FFFFFF";
                }
                write!(html, " data-mx-color=\"{}\"", contrast_color).unwrap();
            }
            None => {}
        }
        match label.description {
            Some(description) => {
                write!(html, " title=\"{}\"", description).unwrap();
            }
            None => {}
        }
        html.push_str(">");
        html.push_str(&label.name);
        html.push_str("</span>");
        i += 1;
    }

    let mut body = ctx.env.create_object()?;
    body.set_named_property("plain", ctx.env.create_string_from_std(plain)?)?;
    body.set_named_property("html", ctx.env.create_string_from_std(html)?)?;
    Ok(body)
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
    jira_issue_result
        .set_named_property("api_url", ctx.env.create_string_from_std(light._self)?)?;

    jira_project.set_named_property(
        "id",
        ctx.env
            .create_string_from_std(jira_issue.fields.project.id)?,
    )?;
    jira_project.set_named_property(
        "key",
        ctx.env
            .create_string_from_std(jira_issue.fields.project.key)?,
    )?;
    jira_project.set_named_property(
        "api_url",
        ctx.env
            .create_string_from_std(jira_issue.fields.project._self)?,
    )?;

    body.set_named_property("uk.half-shot.matrix-hookshot.jira.issue", jira_issue_result)?;
    body.set_named_property("uk.half-shot.matrix-hookshot.jira.project", jira_project)?;
    Ok(body)
}

/// Generate a URL for a given Jira Issue object.
#[js_function(1)]
pub fn hash_id(ctx: CallContext) -> Result<JsString, NapiError> {
    let id = ctx.get::<JsString>(0)?;
    let mut hasher = Md5::new();
    hasher.input(id.into_utf8()?.as_str()?);
    let result = hex::encode(hasher.result());
    ctx.env.create_string_from_std(result)
}