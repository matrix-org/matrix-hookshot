import { z } from "zod";

type StringDate = string;

export type OpenProjectIterableResult<T> = {
  _embedded: { elements: T[] };
  _links?: {
    nextByOffset?: OpenProjectLink;
    nextByCursor?: OpenProjectLink;
  };
};

/** Validates a link while preserving additional fields returned by OpenProject. */
export const OpenProjectLinkSchema = z
  .object({
    href: z.string(),
    title: z.string().optional(),
    method: z.string().optional(),
    templated: z.boolean().optional(),
  })
  .loose();

export type OpenProjectLink = z.infer<typeof OpenProjectLinkSchema>;

const OpenProjectUserReferenceSchema = z
  .object({
    id: z.number().int().positive(),
    _links: z
      .object({
        self: z.object({ href: z.string() }).loose(),
      })
      .loose(),
  })
  .loose();

/** Validates the user reference returned by available-assignee endpoints. */
export const OpenProjectAvailableAssigneeSchema =
  OpenProjectUserReferenceSchema;

export type OpenProjectAvailableAssignee = z.infer<
  typeof OpenProjectAvailableAssigneeSchema
>;

/** Validates one page of OpenProject's available-assignees collection. */
export const OpenProjectAvailableAssigneeCollectionSchema = z
  .object({
    _embedded: z
      .object({
        elements: z.array(OpenProjectAvailableAssigneeSchema),
      })
      .loose(),
    _links: z
      .object({
        nextByOffset: OpenProjectLinkSchema.optional(),
        nextByCursor: OpenProjectLinkSchema.optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type OpenProjectAvailableAssigneeCollection = z.infer<
  typeof OpenProjectAvailableAssigneeCollectionSchema
>;

/** Validates a form property's optional allowed value. */
export const OpenProjectFormAllowedValueSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    isClosed: z.boolean().optional(),
    _type: z.string().optional(),
    _links: z
      .object({ self: OpenProjectLinkSchema.optional() })
      .loose()
      .optional(),
    href: z.string().optional(),
    title: z.string().optional(),
  })
  .loose();

export type OpenProjectFormAllowedValue = z.infer<
  typeof OpenProjectFormAllowedValueSchema
>;

/** Validates fields read from a work-package form schema. */
export const OpenProjectFormPropertySchema = z
  .object({
    type: z.string().optional(),
    writable: z.boolean().optional(),
    _embedded: z
      .object({
        allowedValues: z.array(OpenProjectFormAllowedValueSchema).optional(),
      })
      .loose()
      .optional(),
    _links: z
      .object({
        allowedValues: z.array(OpenProjectLinkSchema).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type OpenProjectFormProperty = z.infer<
  typeof OpenProjectFormPropertySchema
>;

/** Validates an OpenProject work-package form validation error. */
export const OpenProjectFormValidationErrorSchema = z
  .object({
    _type: z.literal("Error").optional(),
    errorIdentifier: z.string().optional(),
    message: z.string(),
  })
  .loose();

export type OpenProjectFormValidationError = z.infer<
  typeof OpenProjectFormValidationErrorSchema
>;

/** Validates the work-package form fields used by assignment and status checks. */
export const OpenProjectWorkPackageFormSchema = z
  .object({
    _embedded: z
      .object({
        payload: z.record(z.string(), z.unknown()),
        schema: z
          .object({
            assignee: OpenProjectFormPropertySchema.optional(),
            status: OpenProjectFormPropertySchema.optional(),
          })
          .loose(),
        validationErrors: z.record(
          z.string(),
          OpenProjectFormValidationErrorSchema,
        ),
      })
      .loose(),
    _links: z
      .object({
        commit: OpenProjectLinkSchema.optional(),
        self: OpenProjectLinkSchema.optional(),
        validate: OpenProjectLinkSchema.optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type OpenProjectWorkPackageForm = z.infer<
  typeof OpenProjectWorkPackageFormSchema
>;

/** Validates the identity fields used by OpenProject commands and eligibility. */
export const OpenProjectIdentitySchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    _links: z
      .object({
        self: z.object({ href: z.string().min(1) }).loose(),
      })
      .loose(),
  })
  .loose();

export type OpenProjectIdentity = z.infer<typeof OpenProjectIdentitySchema>;

/** Validates the work-package fields needed for eligibility and revision checks. */
export const OpenProjectWorkPackageEligibilitySchema = z
  .object({
    id: z.number().int().positive(),
    lockVersion: z.number().int().nonnegative(),
    _embedded: z
      .object({
        project: z.object({ id: z.number().int().positive() }).loose(),
        assignee: OpenProjectUserReferenceSchema.nullish(),
      })
      .loose(),
  })
  .loose();

export interface OpenProjectWorkPackageUpdate {
  _links?: {
    assignee?: { href: string | null };
    responsible?: { href: string | null };
    status?: { href: string };
    priority?: { href: string };
  };
}

export interface OpenProjectWorkPackageFormPayload extends OpenProjectWorkPackageUpdate {
  lockVersion?: number;
}

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
  date: string | null;
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

/**
 * The actor included at the top level of an OpenProject webhook.
 *
 * This is deliberately separate from the work package author. The webhook
 * actor identifies the user who caused the event, while `_embedded.author`
 * identifies who originally created the work package.
 */
export interface OpenProjectWebhookActor {
  id: number;
  name: string;
  _links?: {
    self?: {
      href: string;
      title?: string;
    };
  };
}

export interface OpenProjectWebhookPayloadWorkPackage {
  action: "work_package:created" | "work_package:updated";
  work_package: OpenProjectWorkPackage;
  actor?: OpenProjectWebhookActor;
}

export type OpenProjectWebhookPayload = OpenProjectWebhookPayloadWorkPackage;

export interface OpenProjectStoredToken {
  expires_in: number;
  access_token: string;
  refresh_token: string;
}
