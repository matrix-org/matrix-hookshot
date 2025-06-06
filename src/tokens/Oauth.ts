export interface OAuthRequest {
  state: string;
  code: string;
}
export enum OAuthRequestResult {
  UnknownFailure,
  Success,
  InvalidScope,
  UserNotFound,
}
