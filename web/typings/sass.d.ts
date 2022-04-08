// As per https://lwebapp.com/en/post/cannot-find-module-scss
declare module'*.scss' {
    const content: {[key: string]: any}
    export = content
}
