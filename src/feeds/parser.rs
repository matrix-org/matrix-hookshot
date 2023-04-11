use std::str::FromStr;

use rss::{Channel, Error as RssError};
use napi::{bindgen_prelude::{Error as JsError, Status}};

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
pub struct FeedItem {
    pub title: Option<String>,
    pub link: Option<String>,
    pub id: Option<String>,
    pub id_is_permalink: bool,
}

#[derive(Serialize, Debug, Deserialize)]
#[napi(object)]
pub struct JsRssChannel {
    pub title: String,
    pub items: Vec<FeedItem>,
}


#[napi(js_name = "parseRSSFeed")]
pub fn js_parse_rss_feed(xml: String) -> Result<JsRssChannel, JsError> {
    Channel::from_str(&xml).map(|channel| {
        JsRssChannel {
            title: channel.title().to_string(),
            items: channel.items().iter().map(|item| {
                FeedItem {
                    title: item.title().map(|f| f.to_string()),
                    link: item.link().map(|f| f.to_string()),
                    id: item.guid().map(|f| f.value().to_string()),
                    id_is_permalink: item.guid().map_or(false, |f| f.is_permalink()),
                }
            }).collect()
        }
    }).map_err(|op| {
        match op {
            RssError::Utf8(err) => {
                JsError::new(
                    Status::Unknown,
                    format!("An error while converting bytes to UTF8. {}'", err).to_string(),
                )
            }
            RssError::Xml(err) => {
                JsError::new(
                    Status::Unknown,
                    format!("XML parsing error. {}", err).to_string(),
                )
            }
            RssError::InvalidStartTag => {
                JsError::new(
                    Status::Unknown,
                    format!("The input didn't begin with an opening <rss> tag.").to_string(),
                )
            }
            err => {
                JsError::new(
                    Status::Unknown,
                    format!("Unknown error trying to parse feed parse feed '{}'", err).to_string(),
                )
            }
        }
        
    })
}
