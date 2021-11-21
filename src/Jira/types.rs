#[derive(Serialize, Debug, Deserialize)]
pub struct JiraProject {
    #[serde(rename = "self")] 
    pub _self: String,
    pub id: String,
    pub key: String,
}

#[derive(Serialize, Debug, Deserialize)]

pub struct JiraIssue {
    #[serde(rename = "self")] 
    pub _self: String,
    pub id: String,
    pub key: String,
    pub fields: JiraIssueFields,
}

#[derive(Serialize, Debug, Deserialize)]
pub struct JiraIssueFields {
    pub project: JiraProject
}

#[derive(Serialize, Debug, Deserialize)]
pub struct JiraIssueLight {
    #[serde(rename = "self")] 
    pub _self: String,
    pub key: String,
}
