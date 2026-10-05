/**
 * Compatibility constants for OpenProject timeline event content.
 *
 * These are intentionally separate from the generic to-device transport
 * protocol version.
 */
export const OPENPROJECT_EVENT_SCHEMA_VERSION = 1 as const;
export const OPENPROJECT_ANCHOR_EVENT_KIND = "anchor" as const;
export const OPENPROJECT_UPDATE_EVENT_KIND = "update" as const;
export const OPENPROJECT_ANCHOR_STATE_ACTIVE = "active" as const;
export const OPENPROJECT_ANCHOR_STATE_INACTIVE = "inactive" as const;

export type OpenProjectAnchorState =
  | typeof OPENPROJECT_ANCHOR_STATE_ACTIVE
  | typeof OPENPROJECT_ANCHOR_STATE_INACTIVE;

export type OpenProjectEventKind =
  | typeof OPENPROJECT_ANCHOR_EVENT_KIND
  | typeof OPENPROJECT_UPDATE_EVENT_KIND;
