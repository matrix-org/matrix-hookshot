// As per https://lwebapp.com/en/post/cannot-find-module-scss
declare module "*.scss" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: { [key: string]: any };
  export = content;
}
