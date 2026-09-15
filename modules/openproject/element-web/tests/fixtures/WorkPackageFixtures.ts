import type { OpenProjectWorkPackageContent } from "../../src/components/types";

export const WORK_PACKAGE: OpenProjectWorkPackageContent = {
  id: 50,
  subject: "Build the bridge",
  description: {
    plain: "A short description",
    html: "<p>A short description</p>",
  },
  url: "https://openproject.example/projects/demo-project/work_packages/50",
  author: {
    name: "OpenProject Admin",
    url: "https://openproject.example/users/10",
  },
  assignee: {
    name: "Alice",
    url: "https://openproject.example/users/11",
  },
  status: {
    name: "New",
    color: "#D9D9D9",
  },
  type: {
    name: "Milestone",
    color: "#35C53F",
  },
};
