import { readFileSync } from 'fs';
import JiraApi, { SearchUserOptions } from 'jira-client';
import * as f from 'oauth-sign';
// Step 1. Sign the request

f()

const api = new JiraApi({ 
    host: 'localhost',
    port: 9050,
    oauth: {
        consumer_key: '',
        consumer_secret: readFileSync('jira_privatekey.pem', 'utf-8')
    }
});