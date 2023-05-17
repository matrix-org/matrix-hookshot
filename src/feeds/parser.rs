use std::str::FromStr;

use atom_syndication::{Error as AtomError, Feed, Person};
use napi::bindgen_prelude::{Error as JsError, Status};
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
                    .and_then(|f| hash_id(f).ok()),
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
                link: item.links().first().map(|f| f.href.clone()),
                id: Some(item.id.clone()),
                // No equivalent
                id_is_permalink: false,
                pubdate: item
                    .published
                    .or(Some(item.updated))
                    .map(|date| date.to_rfc2822()),
                summary: item.summary().map(|v| v.value.clone()),
                author: authors_to_string(item.authors()),
                hash_id: hash_id(item.id.clone()).ok(),
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
