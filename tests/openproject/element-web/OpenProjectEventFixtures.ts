/**
 * Representative Matrix timeline events emitted for OpenProject work packages.
 *
 * The update event contains the same current work-package snapshot emitted by
 * the existing backend contract.
 */
const WORK_PACKAGE_URL =
  "https://elementio-demo.openproject.com/projects/demo-project/work_packages/41";

const PROJECT_URL = "https://elementio-demo.openproject.com/projects/1";

const WORK_PACKAGE_CONTENT = {
  id: 41,
  subject: "This is a task",
  description: {
    plain: "",
    html: "",
  },
  url: WORK_PACKAGE_URL,
  author: {
    name: "OpenProject User",
    url: "https://elementio-demo.openproject.com/users/4",
  },
  status: {
    color: "#1098AD",
    name: "New",
  },
  type: {
    color: "#1A67A3",
    name: "Task",
  },
} as const;

const PROJECT_CONTENT = {
  id: 1,
  name: "Demo project",
  url: PROJECT_URL,
} as const;

export const OPENPROJECT_WORK_PACKAGE_CREATED_EVENT = {
  content: {
    body:
      "OpenProject User created a new work package [41](" +
      WORK_PACKAGE_URL +
      '): "This is a task"',
    external_url: WORK_PACKAGE_URL,
    format: "org.matrix.custom.html",
    formatted_body:
      'OpenProject User created a new work package <a href="' +
      WORK_PACKAGE_URL +
      '">41</a>: &quot;This is a task&quot;',
    "m.mentions": {},
    "org.matrix.matrix-hookshot.openproject.project": PROJECT_CONTENT,
    "org.matrix.matrix-hookshot.openproject.work_package": WORK_PACKAGE_CONTENT,
    msgtype: "m.notice",
  },
  event_id: "$openproject-created-work-package-41",
  origin_server_ts: 1788258920336,
  room_id: "!openproject:example.test",
  sender: "@openproject:example.test",
  type: "m.room.message",
  unsigned: {},
} as const;

export const OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT = {
  content: {
    body:
      "**OpenProject User** updated the subject for [41](" +
      WORK_PACKAGE_URL +
      '): "This is an updated task"',
    external_url: WORK_PACKAGE_URL,
    format: "org.matrix.custom.html",
    formatted_body:
      '<strong>OpenProject User</strong> updated the subject for <a href="' +
      WORK_PACKAGE_URL +
      '">41</a>: &quot;This is an updated task&quot;',
    "m.mentions": {},
    "org.matrix.matrix-hookshot.openproject.project": PROJECT_CONTENT,
    "org.matrix.matrix-hookshot.openproject.work_package": {
      ...WORK_PACKAGE_CONTENT,
      subject: "This is an updated task",
    },
    msgtype: "m.notice",
  },
  event_id: "$openproject-updated-work-package-41",
  origin_server_ts: 1788258980336,
  room_id: "!openproject:example.test",
  sender: "@openproject:example.test",
  type: "m.room.message",
  unsigned: {},
} as const;

/**
 * Renderer-only input for the dormant changed-work-package component.
 *
 * Hookshot does not currently emit the `.changed` key. Keep this fixture out
 * of webhook and backend-contract tests until that contract is introduced.
 */
export const SYNTHETIC_OPENPROJECT_WORK_PACKAGE_CHANGED_EVENT = {
  ...OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT,
  content: {
    ...OPENPROJECT_WORK_PACKAGE_UPDATED_EVENT.content,
    "org.matrix.matrix-hookshot.openproject.work_package.changed": {
      subject: "This is a task",
    },
  },
  event_id: "$synthetic-openproject-changed-work-package-41",
} as const;
