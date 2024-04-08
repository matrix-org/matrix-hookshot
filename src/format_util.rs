use crate::github::types::*;
use crate::jira;
use crate::jira::types::{JiraIssue, JiraIssueLight, JiraIssueMessageBody, JiraIssueSimpleItem};
use contrast::contrast;
use md5::{Digest, Md5};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rgb::RGB;
use ruma::html::{sanitize_html, HtmlSanitizerMode, RemoveReplyFallback};
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
    let color = if input_color.starts_with('#') {
        let mut chars = input_color.chars();
        chars.next();
        String::from_iter(chars)
    } else {
        input_color
    };
    let chunk_size = match color.len() {
        6 => 2,
        3 => 1,
        _ => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("color '{}' is invalid", color),
            ));
        }
    };
    let mut rgb = RGB::default();
    let i = 0;
    for color_byte in color.as_bytes().chunks(chunk_size) {
        let val = std::str::from_utf8(color_byte)
            .map_err(|e| {
                Error::new(
                    Status::InvalidArg,
                    format!("UTF8Error '{}' when converting rgb component", e),
                )
            })
            .and_then(|v| {
                u8::from_str_radix(v, 16).map_err(|e| {
                    Error::new(
                        Status::InvalidArg,
                        format!("Integer parse error '{}' when converting rgb component", e),
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
    for (i, label) in array.into_iter().enumerate() {
        if i != 0 {
            plain.push_str(", ");
            html.push(' ');
        }
        plain.push_str(&label.name);

        // HTML
        html.push_str("<span");
        if let Some(color) = label.color {
            write!(html, " data-mx-bg-color=\"#{}\"", color).unwrap();
            // Determine the constrast
            let color_rgb = parse_rgb(color)?;
            let contrast_color = if contrast::<u8, f32>(color_rgb, RGB::new(0, 0, 0)) > 4.5 {
                "#000000"
            } else {
                "#FFFFFF"
            };
            write!(html, " data-mx-color=\"{}\"", contrast_color).unwrap();
        }
        if let Some(description) = label.description {
            write!(html, " title=\"{}\"", description).unwrap();
        }
        html.push('>');
        html.push_str(&label.name);
        html.push_str("</span>");
    }

    Ok(MatrixMessageFormatResult { html, plain })
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
    let external_url = jira::utils::generate_jira_web_link_from_issue(&light_issue)?;

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
        external_url,
    })
}

/// Generate a URL for a given Jira Issue object.
#[napi]
pub fn hash_id(id: String) -> Result<String> {
    let mut hasher = Md5::new();
    hasher.update(id);
    Ok(hex::encode(hasher.finalize()))
}

#[napi(js_name = "sanitizeHtml")]
pub fn hookshot_sanitize_html(html: String) -> String {
    return sanitize_html(
        html.as_str(),
        HtmlSanitizerMode::Compat,
        RemoveReplyFallback::No,
    );
}
