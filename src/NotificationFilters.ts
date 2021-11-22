
interface FilterContent {
    users: string[];
    repos: string[];
    orgs: string[];
}

export interface NotificationFilterStateContent {
    filters: {
        [name: string]: FilterContent;
    };
    forNotifications: string[];
    forInvites: string[];
}

/**
 * A notification filter is a set of keys that define what should be sent to the user.
 */
export class NotifFilter {
    static readonly StateType = "uk.half-shot.matrix-github.notif-filter";
    static readonly LegacyStateType = "uk.half-shot.matrix-hookshot.notif-filter";

    static getDefaultContent(): NotificationFilterStateContent {
        return {
            filters: {},
            forNotifications: [],
            forInvites: [],
        }
    }

    public readonly forNotifications: Set<string>;
    public readonly forInvites: Set<string>;
    public filters: Record<string, FilterContent>;
    constructor(stateContent: NotificationFilterStateContent) {
        this.forNotifications = new Set(stateContent.forNotifications);
        this.forInvites = new Set(stateContent.forInvites);
        this.filters = stateContent.filters;
    }

    public get empty() {
        return Object.values(this.filters).length === 0;
    }

    public getStateContent(): NotificationFilterStateContent {
        return {
            filters: this.filters,
            forInvites: [...this.forInvites],
            forNotifications: [...this.forNotifications],
        };
    }

    public shouldInviteToRoom(user: string, repo: string, org: string): boolean {
        return false;
    }

    public shouldSendNotification(user?: string, repo?: string, org?: string): boolean {
        if (this.forNotifications.size === 0) {
            // Default on.
            return true;
        }
        for (const filterName of this.forNotifications) {
            const filter  = this.filters[filterName];
            if (!filter) {
                // Filter with this name exists.
                continue;
            }
            if (user && filter.users.includes(user.toLowerCase())) {
                // We have a user in this notif and we are filtering on users.
                return true;
            }
            if (repo && filter.repos.includes(repo.toLowerCase())) {
                // We have a repo in this notif and we are filtering on repos.
                return true;
            }
            if (org && filter.orgs.includes(org.toLowerCase())) {
                // We have an org in this notif and we are filtering on orgs.
                return true;
            }
            // None of the filters matched, so exclude the result.
            return false;
        }
        return false;
    }

    public setFilter(name: string, filter: FilterContent) {
        this.filters[name] = filter;
    }
}