

type StringDate = string;

export interface OpenProjectUser {
    id: number,
    name: string,
    login: string,
    createdAt: StringDate,
    updatedAt: StringDate,
    avatar: string,
    status: 'active'
}

export interface OpenProjectStatus {
    id: number,
    name: string,
    isClosed: boolean,
    isDefault: boolean,
    isReadonly: boolean,
    color: string,
}

export interface OpenProjectType {
    id: number,
    name: string,
    isDefault: boolean,
    createdAt: StringDate,
    updatedAt: StringDate,
    color: string,
}

export interface OpenProjectPriority {
    id: number,
    name: string,
    isDefault: boolean,
    isActive: boolean,
    createdAt: StringDate,
    updatedAt: StringDate,
    color: string,
}

export interface OpenProjectProject {
    id: number,
    identifer: string,
    name: string,
    active: boolean,
    public: boolean,
    createdAt: StringDate,
    updatedAt: StringDate,
    description: {
        format: 'markdown',
        raw: string,
        html: string,
    },
}

export interface OpenProjectWebhookPayloadWorkPackage {
    action: 'work_package:created',
    work_package: {
        _type: 'WorkPackage',
        id: number,
        lockVersion: number,
        subject: string,
        description: { format: 'markdown', raw: '', html: '' },
        scheduleManually: boolean,
        startDate: null,
        dueDate: null,
        derivedStartDate: null,
        derivedDueDate: null,
        estimatedTime: null,
        derivedEstimatedTime: null,
        derivedRemainingTime: null,
        duration: null,
        ignoreNonWorkingDays: boolean,
        percentageDone: null,
        derivedPercentageDone: null,
        createdAt: StringDate,
        updatedAt: StringDate,
        _embedded: {
            // attachments: [Object],
            // relations: [Object],
            type: OpenProjectType,
            priority: OpenProjectPriority,
            project: OpenProjectProject,
            status: OpenProjectStatus,
            author: OpenProjectUser,
            responsible?: OpenProjectUser,
            assignee?: OpenProjectUser,
            // customActions: []
        },
        _links: {
            self: object,
        }
    }

}

export type OpenProjectWebhookPayload = OpenProjectWebhookPayloadWorkPackage;