/* eslint-disable camelcase */
import { ILabel } from "./FormatUtil";
import { JiraIssue } from "./Jira/Types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
let rootModule;
try {
    // In production, we expect it co-located
    rootModule = require('./matrix-hookshot-rs.node');
} catch (ex) {
    // When running under ts-node, it may not be co-located.
    rootModule = require('../lib/matrix-hookshot-rs.node');
}

interface FormatUtil {
    get_partial_body_for_jira_issue: (issue: JiraIssue) => Record<string, unknown>
    format_labels: (labels: ILabel[]) => { plain: string, html: string }
}

interface JiraModule {
    utils: {
        generate_jira_web_link_from_issue: (issue: {self: string, key: string}) => string;
    }
}


export const format_util = rootModule.format_util as FormatUtil;
export const jira = rootModule.jira as JiraModule;