/**
 * Compatibility constants for OpenProject timeline event content.
 *
 * This is duplicated from the Hookshot-side schema module because the server
 * and browser module are separate build boundaries.
 */
export const OPENPROJECT_EVENT_SCHEMA_VERSION = 1 as const;
export const OPENPROJECT_ANCHOR_EVENT_KIND = "anchor" as const;
