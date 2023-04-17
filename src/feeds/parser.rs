use std::str::FromStr;

use napi::bindgen_prelude::{Error as JsError, Status};
use rss::{Channel, Error as RssError};

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
}

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
pub struct JsRssChannel {
    pub title: String,
    pub items: Vec<FeedItem>,
}
#[napi(js_name = "parseRSSFeed")]
pub fn js_parse_rss_feed(xml: String) -> Result<JsRssChannel, JsError> {
    fn map_item_value(original: &str) -> String {
        original.to_string()
    }

    Channel::from_str(&xml)
        .map(|channel| JsRssChannel {
            title: channel.title().to_string(),
            items: channel
                .items()
                .iter()
                .map(|item| FeedItem {
                    title: item.title().map(map_item_value),
                    link: item.link().map(map_item_value),
                    id: item.guid().map(|f| f.value().to_string()),
                    id_is_permalink: item.guid().map_or(false, |f| f.is_permalink()),
                    pubdate: item.pub_date().map(map_item_value),
                    summary: item.description().map(map_item_value),
                    author: item.author().map(map_item_value),
                })
                .collect(),
        })
        .map_err(|op| match op {
            RssError::Utf8(err) => JsError::new(
                Status::Unknown,
                format!("An error while converting bytes to UTF8. {}'", err).to_string(),
            ),
            RssError::Xml(err) => JsError::new(
                Status::Unknown,
                format!("XML parsing error. {}", err).to_string(),
            ),
            RssError::InvalidStartTag => JsError::new(
                Status::Unknown,
                format!("The input didn't begin with an opening <rss> tag.").to_string(),
            ),
            err => JsError::new(
                Status::Unknown,
                format!("Unknown error trying to parse feed parse feed '{}'", err).to_string(),
            ),
        })
}
