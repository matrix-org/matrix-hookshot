/* eslint-disable camelcase */
import { JiraIssue } from "./Jira/Types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rootModule = require('../lib/matrix-github-rs.node');

interface FormatUtil {
    get_partial_body_for_jira_issue: (issue: JiraIssue) => Record<string, unknown>
}

interface JiraModule {
    utils: {
        generate_jira_web_link_from_issue: (issue: {self: string, key: string}) => string;
    }
}


export const format_util = rootModule.format_util as FormatUtil;
export const jira = rootModule.jira as JiraModule;