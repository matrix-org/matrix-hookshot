use crate::Github::types::*;
use crate::Jira;
use crate::Jira::types::{JiraIssue, JiraIssueLight, JiraIssueMessageBody, JiraIssueSimpleItem};
use ammonia::{Builder, UrlRelative};
use contrast;
use md5::{Digest, Md5};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rgb::RGB;
use std::fmt::Write;

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
pub struct IssueLabelDetail {
    pub color: Option<String>,
    pub name: String,
    pub description: Option<String>,
}

#[napi(object)]
pub struct MatrixMessageFormatResult {
    pub html: String,
    pub plain: String,
}

fn parse_rgb(input_color: String) -> Result<rgb::RGB8> {
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
            return Err(Error::new(
                Status::InvalidArg,
                format!("color '{}' is invalid", color).to_string(),
            ));
        }
    }
    let mut rgb = RGB::default();
    let i = 0;
    for color_byte in color.as_bytes().chunks(chunk_size) {
        let val = std::str::from_utf8(color_byte)
            .map_err(|e| {
                Error::new(
                    Status::InvalidArg,
                    format!("UTF8Error '{}' when converting rgb component", e).to_string(),
                )
            })
            .and_then(|v| {
                u8::from_str_radix(v, 16).map_err(|e| {
                    Error::new(
                        Status::InvalidArg,
                        format!("Integer parse error '{}' when converting rgb component", e)
                            .to_string(),
                    )
                })
            })?;
        if i == 0 {
            rgb.r = val;
        } else if i == 1 {
            rgb.g = val;
        } else if i == 2 {
            rgb.b = val;
        }
    }
    Ok(rgb)
}

#[napi]
pub fn format_labels(array: Vec<IssueLabelDetail>) -> Result<MatrixMessageFormatResult> {
    let mut plain = String::new();
    let mut html = String::new();
    let mut i = 0;
    for label in array {
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

    Ok(MatrixMessageFormatResult {
        html: html,
        plain: plain,
    })
}

/// Generate extra message content for GitHub repo related events
#[napi]
pub fn get_partial_body_for_github_repo(repo: MinimalGitHubRepo) -> GitHubRepoMessageBody {
    GitHubRepoMessageBody {
        external_url: repo.html_url.clone(),
        repo: GitHubIssueMessageBodyRepo {
            id: repo.id,
            name: repo.full_name,
            url: repo.html_url,
        },
    }
}

/// Generate extra message content for GitHub issue related events
#[napi]
pub fn get_partial_body_for_github_issue(
    repo: MinimalGitHubRepo,
    issue: MinimalGitHubIssue,
) -> GitHubIssueMessageBody {
    GitHubIssueMessageBody {
        external_url: issue.html_url.clone(),
        issue: GitHubIssueMessageBodyIssue {
            id: issue.id,
            title: issue.title,
            number: issue.number,
            url: issue.html_url,
        },
        repo: GitHubIssueMessageBodyRepo {
            id: repo.id,
            name: repo.full_name,
            url: repo.html_url,
        },
    }
}

/// Generate a URL for a given Jira Issue object.
#[napi]
pub fn get_partial_body_for_jira_issue(jira_issue: JiraIssue) -> Result<JiraIssueMessageBody> {
    let light_issue = JiraIssueLight {
        _self: jira_issue._self,
        key: jira_issue.key,
    };
    let external_url = Jira::utils::generate_jira_web_link_from_issue(&light_issue)?;

    Ok(JiraIssueMessageBody {
        jira_issue: JiraIssueSimpleItem {
            id: jira_issue.id,
            key: light_issue.key,
            api_url: light_issue._self,
        },
        jira_project: JiraIssueSimpleItem {
            id: jira_issue.fields.project.id,
            key: jira_issue.fields.project.key,
            api_url: jira_issue.fields.project._self,
        },
        external_url: external_url,
    })
}

/// Generate a URL for a given Jira Issue object.
#[napi]
pub fn hash_id(id: String) -> Result<String> {
    let mut hasher = Md5::new();
    hasher.input(id);
    Ok(hex::encode(hasher.result()))
}

const ALLOWED_HTML_TAGS: &'static [&'static str] = &[
    "font",
    "del",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "p",
    "a",
    "ul",
    "ol",
    "sup",
    "sub",
    "li",
    "b",
    "i",
    "u",
    "strong",
    "em",
    "strike",
    "code",
    "hr",
    "br",
    "div",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "caption",
    "pre",
    "span",
    "img",
    "details",
    "summary",
];

const FONT_ALLOWED_ATTRIBUTES: &'static [&'static str] =
    &["data-mx-bg-color", "data-mx-color", "color"];

const SPAN_ALLOWED_ATTRIBUTES: &'static [&'static str] =
    &["data-mx-bg-color", "data-mx-color", "data-mx-spoiler"];

const ANCHOR_ALLOWED_ATTRIBUTES: &'static [&'static str] = &["name", "target", "href"];

const IMG_ALLOWED_ATTRIBUTES: &'static [&'static str] = &["width", "height", "alt", "title", "src"];

const OL_ALLOWED_ATTRIBUTES: &'static [&'static str] = &["start"];
const CODE_ALLOWED_ATTRIBUTES: &'static [&'static str] = &["class"];

const ALLOWED_URL_SCHEMES: &'static [&'static str] =
    &["https", "http", "ftp", "mailto", "magnet", "mxc"];

#[napi]
pub fn sanitize_html(html: String) -> String {
    // See https://spec.matrix.org/v1.6/client-server-api/#mroommessage-msgtypes
    Builder::default()
        .link_rel(None)
        .add_tags(ALLOWED_HTML_TAGS)
        .add_tag_attributes("font", FONT_ALLOWED_ATTRIBUTES)
        .add_tag_attributes("span", SPAN_ALLOWED_ATTRIBUTES)
        .add_tag_attributes("a", ANCHOR_ALLOWED_ATTRIBUTES)
        .add_tag_attributes("img", IMG_ALLOWED_ATTRIBUTES)
        .add_tag_attributes("ol", OL_ALLOWED_ATTRIBUTES)
        .add_tag_attributes("code", CODE_ALLOWED_ATTRIBUTES)
        .add_url_schemes(ALLOWED_URL_SCHEMES)
        .attribute_filter(|element, attribute, value| match (element, attribute) {
            ("code", "class") => {
                if value.starts_with("language-") {
                    return Some(value.into());
                }
                None
            }
            _ => Some(value.into()),
        })
        .url_relative(UrlRelative::PassThrough)
        .clean(html.as_str())
        .to_string()
}
