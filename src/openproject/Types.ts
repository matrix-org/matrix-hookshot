type StringDate = string;

export type OpenProjectIterableResult<T> = {
  _embedded: { elements: T[] };
};

export interface OpenProjectUser {
  id: number;
  name: string;
  login: string;
  createdAt: StringDate;
  updatedAt: StringDate;
  avatar: string;
  status: "active";
  _links: {
    self: {
      href: string;
      title: string;
    };
  };
}

export interface OpenProjectStatus {
  id: number;
  name: string;
  isClosed: boolean;
  isDefault: boolean;
  isReadonly: boolean;
  color: string;
  _links: {
    self: {
      href: string;
      title: string;
    };
  };
}

export interface OpenProjectType {
  id: number;
  name: string;
  isDefault: boolean;
  createdAt: StringDate;
  updatedAt: StringDate;
  color: string;
  _links: {
    self: {
      href: string;
      title: string;
    };
  };
}

export interface OpenProjectPriority {
  id: number;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: StringDate;
  updatedAt: StringDate;
  color: string;
  _links: {
    self: {
      href: string;
    };
  };
}

export interface OpenProjectProject {
  id: number;
  identifier: string;
  name: string;
  active: boolean;
  public: boolean;
  createdAt: StringDate;
  updatedAt: StringDate;
  description: {
    format: "markdown";
    raw: string;
    html: string;
  };
  _links: {
    memberships: {
      href: string;
    };
  };
}

export interface OpenProjectWorkPackage {
  _type: "WorkPackage";
  id: number;
  lockVersion: number;
  subject: string;
  description: { format: "markdown"; raw: string; html?: string };
  scheduleManually: boolean;
  startDate: null;
  dueDate: string | null;
  derivedStartDate: null;
  derivedDueDate: null;
  estimatedTime: null;
  derivedEstimatedTime: null;
  derivedRemainingTime: null;
  duration: null;
  ignoreNonWorkingDays: boolean;
  percentageDone: number | null;
  derivedPercentageDone: null;
  createdAt: StringDate;
  updatedAt: StringDate;
  _embedded: {
    // attachments: [Object],
    // relations: [Object],
    type: OpenProjectType;
    priority: OpenProjectPriority;
    project: OpenProjectProject;
    status: OpenProjectStatus;
    author: OpenProjectUser;
    responsible?: OpenProjectUser;
    assignee?: OpenProjectUser;
    // customActions: []
  };
  _links: {
    self: object;
  };
}

export interface OpenProjectMembership {
  _type: "Membership";
  id: number;
  _links: {
    principal: {
      href: string;
      title: string;
    };
    roles: {
      href: string;
      title: string;
    }[];
  };
}

export interface OpenProjectWebhookPayloadWorkPackage {
  action: "work_package:created" | "work_package:updated";
  work_package: OpenProjectWorkPackage;
}

export type OpenProjectWebhookPayload = OpenProjectWebhookPayloadWorkPackage;

export interface OpenProjectStoredToken {
  expires_in: number;
  access_token: string;
  refresh_token: string;
}
