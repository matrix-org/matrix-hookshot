export interface DiscussionQLResponse {
    id: string;
    number: number;
    author: {
        login: string;
        avatarUrl: string;
    };
    bodyHTML: string;
    bodyText: string;
    category: {
        name: string;
        id: string;
    };
    createdAt: string;
    locked: boolean;
    title: string;
    url: string;
}

export const DiscussionQL = `
id,
number,
answer {
    id,
}
author{
    login,
    avatarUrl,
}
bodyHTML,
bodyText,
category {
    name,
    id,
},
createdAt,
locked,
title,
url,
`