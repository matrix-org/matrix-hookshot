use std::{str::FromStr, time::Duration};

use atom_syndication::{Error as AtomError, Feed, Person};
use napi::bindgen_prelude::{Error as JsError, Status};
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Method, StatusCode,
};
use rss::{Channel, Error as RssError};

use crate::format_util::hash_id;

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
pub struct FeedItem {
    pub title: Option<String>,
    pub link: Option<String>,
    pub id: Option<String>,
    pub id_is_permalink: bool,
    pub pubdate: Option<String>,
    pub summary: Option<String>,
    pub author: Option<String>,
    pub hash_id: Option<String>,
}

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
pub struct JsRssChannel {
    pub title: String,
    pub items: Vec<FeedItem>,
}

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
pub struct ReadFeedOptions {
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub poll_timeout_seconds: i64,
    pub user_agent: String,
}

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
pub struct FeedResult {
    pub feed: Option<JsRssChannel>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

fn parse_channel_to_js_result(channel: &Channel) -> JsRssChannel {
    JsRssChannel {
        title: channel.title().to_string(),
        items: channel
            .items()
            .iter()
            .map(|item: &rss::Item| FeedItem {
                title: item.title().map(String::from),
                link: item.link().map(ToString::to_string).or_else(|| {
                    item.guid()
                        .and_then(|i| i.permalink.then(|| i.value.to_string()))
                }),
                id: item.guid().map(|f| f.value().to_string()),
                id_is_permalink: item.guid().map_or(false, |f| f.is_permalink()),
                pubdate: item.pub_date().map(String::from),
                summary: item.description().map(String::from),
                author: item.author().map(String::from),
                hash_id: item
                    .guid
                    .clone()
                    .map(|f| f.value)
                    .or(item.link.clone())
                    .or(item.title.clone())
                    .and_then(|f| hash_id(f).ok())
                    .map(|f| format!("md5:{}", f)),
            })
            .collect(),
    }
}

fn parse_feed_to_js_result(feed: &Feed) -> JsRssChannel {
    fn authors_to_string(persons: &[Person]) -> Option<String> {
        if persons.is_empty() {
            return None;
        }
        let mut outs = Vec::<String>::new();
        for person in persons {
            let email = person
                .email
                .clone()
                .map_or_else(String::new, |v| format!("<{}>", v));
            let uri = person
                .uri
                .clone()
                .map_or_else(String::new, |v| format!("<{}>", v));
            outs.push(format!("{}{}{}", person.name, email, uri))
        }
        Some(outs.join(", "))
    }
    JsRssChannel {
        title: feed.title().to_string(),
        items: feed
            .entries()
            .iter()
            .map(|item| FeedItem {
                title: Some(item.title().value.clone()),
                link: item
                    .links()
                    .iter()
                    .find(|l| l.mime_type.as_ref().map_or(false, |t| t == "text/html"))
                    .or_else(|| item.links().first())
                    .map(|f| f.href.clone()),
                id: Some(item.id.clone()),
                // No equivalent
                id_is_permalink: false,
                pubdate: item
                    .published
                    .or(Some(item.updated))
                    .map(|date| date.to_rfc2822()),
                summary: item.summary().map(|v| v.value.clone()),
                author: authors_to_string(item.authors()),
                hash_id: hash_id(item.id.clone()).ok().map(|f| format!("md5:{}", f)),
            })
            .collect(),
    }
}

#[napi(js_name = "parseFeed")]
pub fn js_parse_feed(xml: String) -> Result<JsRssChannel, JsError> {
    match Channel::from_str(&xml) {
        Ok(channel) => Ok(parse_channel_to_js_result(&channel)),
        Err(RssError::InvalidStartTag) =>
        // If the tag is wrong, parse again as a feed.
        {
            match Feed::from_str(&xml) {
                Ok(feed) => Ok(parse_feed_to_js_result(&feed)),
                Err(AtomError::Eof) => {
                    Err(JsError::new(Status::Unknown, "Unexpected end of input."))
                }
                Err(AtomError::InvalidStartTag) => Err(JsError::new(
                    Status::Unknown,
                    "An error while converting bytes to UTF8.",
                )),
                Err(AtomError::WrongAttribute { attribute, value }) => Err(JsError::new(
                    Status::Unknown,
                    format!(
                        "The attribute '{}' had the wrong value '{}'",
                        attribute, value
                    ),
                )),
                Err(AtomError::WrongDatetime(value)) => Err(JsError::new(
                    Status::Unknown,
                    format!("The format of the datetime ('{}') was wrong.", value),
                )),
                Err(AtomError::Xml(err)) => Err(JsError::new(
                    Status::Unknown,
                    format!("XML parsing error . {}'", err),
                )),
                Err(err) => Err(JsError::new(
                    Status::Unknown,
                    format!("Unknown error trying to parse feed parse feed '{}'", err),
                )),
            }
        }
        Err(RssError::Utf8(err)) => Err(JsError::new(
            Status::Unknown,
            format!("An error while converting bytes to UTF8. {}'", err),
        )),
        Err(RssError::Xml(err)) => Err(JsError::new(
            Status::Unknown,
            format!("XML parsing error. {}", err),
        )),
        Err(RssError::Eof) => Err(JsError::new(Status::Unknown, "Unexpected end of input")),
    }
}

#[napi(js_name = "readFeed")]
pub async fn js_read_feed(url: String, options: ReadFeedOptions) -> Result<FeedResult, JsError> {
    let client = reqwest::Client::new();
    let req = client
        .request(Method::GET, url)
        .timeout(Duration::from_secs(
            options.poll_timeout_seconds.try_into().unwrap(),
        ));

    let mut headers: HeaderMap = HeaderMap::new();

    headers.append(
        "User-Agent",
        HeaderValue::from_str(&options.user_agent).unwrap(),
    );

    if let Some(last_modifed) = options.last_modified {
        headers.append(
            "If-Modified-Since",
            HeaderValue::from_str(&last_modifed).unwrap(),
        );
    }
    if let Some(etag) = options.etag {
        headers.append("If-None-Match", HeaderValue::from_str(&etag).unwrap());
    }

    match req.headers(headers).send().await {
        Ok(res) => {
            let res_headers = res.headers().clone();
            match res.status() {
                StatusCode::OK => match res.text().await {
                    Ok(body) => match js_parse_feed(body) {
                        Ok(feed) => Ok(FeedResult {
                            feed: Some(feed),
                            etag: res_headers
                                .get("ETag")
                                .map(|v| v.to_str().unwrap())
                                .map(|v| v.to_string()),
                            last_modified: res_headers
                                .get("Last-Modified")
                                .map(|v| v.to_str().unwrap())
                                .map(|v| v.to_string()),
                        }),
                        Err(err) => Err(err),
                    },
                    Err(err) => Err(JsError::new(Status::Unknown, err)),
                },
                StatusCode::NOT_MODIFIED => Ok(FeedResult {
                    feed: None,
                    etag: None,
                    last_modified: None,
                }),
                status => Err(JsError::new(
                    Status::Unknown,
                    format!("Failed to fetch feed due to HTTP status {}", status),
                )),
            }
        }
        Err(err) => Err(JsError::new(
            Status::Unknown,
            format!("Failed to fetch feed due to HTTP error {}", err),
        )),
    }
}
