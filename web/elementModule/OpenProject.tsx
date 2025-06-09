import { styled } from "styled-components";
import { Button } from "@vector-im/compound-web";
import PopOutIcon from "@vector-im/compound-design-tokens/assets/web/icons/pop-out";
export interface OpenProjectContent {
    "org.matrix.matrix-hookshot.openproject.work_package"?: {
        id: number;
        subject: string;
        description: {
            plain: string;
            html: string;
        };
        url: string;
        author: {
            name: string;
            url: string;
        };
        responsible?: {
            name: string;
            url: string;
        };
        assignee?: {
            name: string;
            url: string;
        };
        status: {
            name: string;
            color: string;
        };
        type: {
            name: string;
            color: string;
        };
        priority?: {
            name: string;
            color: string;
        };
        percentageDone?: number | null;
        dueDate?: string | null;
    };
    "org.matrix.matrix-hookshot.openproject.project"?: {
        id: number;
        name: string;
        url: string;
    };
    "org.matrix.matrix-hookshot.commands": {
        "org.matrix.matrix-hookshot.openproject.command.close": {
            label: "Close work package";
        };
    };
    "org.matrix.matrix-hookshot.openproject.work_package.changed"?: {
        subject?: string;
        description?: {
            plain: string;
            html?: string;
        };
        assignee?: number;
        status?: {
            name: string;
            color: string;
        };
        type?: number;
        responsible?: number;
        priority?: {
            name: string;
            color: string;
        };
        percentageDone?: number | null;
        dueDate?: string | null;
    };
}

const Root = styled.div`
    margin-top: var(--cpd-space-1x);
    margin-bottom: var(--cpd-space-1x);
    gap: var(--cpd-space-2x);
    display: flex;
    flex-direction: column;
`;

const WidgetWorkPackageStatus = styled.div`
    border-radius: 1em;
    width: 0.9em;
    height: 0.9em;
    display: inline-block;
    margin-right: var(--cpd-space-1x);
`;

const WidgetRow = styled.div`
    gap: var(--cpd-space-4x);
    display: flex;
    flex-direction: row;
    color: var(--cpd-color-text-secondary);
    margin-top: auto;
    margin-bottom: auto;
`;

const WidgetWorkPackageTitle = styled.a`
    font-weight: var(--cpd-font-weight-semibold);
`;

const WidgetDescription = styled.div`
    > p {
        margin: 0;
    }
`;

const WidgetBorder = styled.div`
    width: var(--cpd-space-0-5x);
    height: auto;
    border-radius: var(--cpd-space-1x);
`;
const WidgetWrapper = styled.div`
    display: flex;
    flex-direction: row;
    gap: var(--cpd-space-3x);
    margin-top: var(--cpd-space-2x);
    margin-bottom: var(--cpd-space-2x);
`;

const WidgetChangedText = styled.div`
    color: var(--cpd-color-text-secondary);
`;

export function OpenProjectEventWidgetChanged({ data }: { data: OpenProjectContent }) {
    const {
        ["org.matrix.matrix-hookshot.openproject.work_package"]: pkg,
        "org.matrix.matrix-hookshot.openproject.work_package.changed": changes,
    } = data;
    if (!pkg || !changes) {
        return null;
    }
    let innerContent = null;
    if (changes.assignee !== undefined) {
        innerContent = (
            <WidgetChangedText>
                Assignee changed to <strong>{pkg.assignee?.name ?? "Nobody"}</strong>
            </WidgetChangedText>
        );
    } else if (changes.description !== undefined) {
        innerContent = (
            <WidgetChangedText>
                <span>Description changed</span>
                <details dangerouslySetInnerHTML={{ __html: pkg.description.html }} />
            </WidgetChangedText>
        );
    } else if (changes.dueDate !== undefined) {
        innerContent = (
            <WidgetChangedText>
                Due date changed to <strong>{pkg.dueDate}</strong>
            </WidgetChangedText>
        );
    } else if (changes.percentageDone !== undefined) {
        innerContent = (
            <WidgetChangedText>
                Work package is now <strong>{pkg.percentageDone}</strong>% complete
            </WidgetChangedText>
        );
    } else if (changes.priority !== undefined) {
        innerContent = (
            <WidgetChangedText>
                Priority changed from <strong>{changes.priority.name}</strong> to <strong>{pkg.priority?.name}</strong>
            </WidgetChangedText>
        );
    } else if (changes.responsible !== undefined) {
        innerContent = (
            <WidgetChangedText>
                Updated accountable person to <strong>{pkg.responsible?.name ?? "Nobody"}</strong>
            </WidgetChangedText>
        );
    } else if (changes.status !== undefined) {
        innerContent = (
            <WidgetChangedText>
                Status changed from{" "}
                <span>
                    <WidgetWorkPackageStatus style={{ background: changes.status.color }} />
                    {changes.status.name}
                </span>{" "}
                to{" "}
                <span>
                    <WidgetWorkPackageStatus style={{ background: pkg.status.color }} />
                    {pkg.status.name}
                </span>
            </WidgetChangedText>
        );
    } else if (changes.subject !== undefined) {
        innerContent = <WidgetChangedText>Subject changed</WidgetChangedText>;
    } else if (changes.type !== undefined) {
        innerContent = (
            <WidgetChangedText>
                Type changed to <strong>{pkg.type.name}</strong>
            </WidgetChangedText>
        );
    }

    return (
        <div>
            <span>
                Work package <a href={pkg.url}>{pkg.id}</a> updated
            </span>
            <WidgetWrapper>
                <WidgetBorder style={{ background: pkg?.type.color }} />
                <Root>
                    <WidgetWorkPackageTitle href={pkg.url}>
                        #{pkg.id} {pkg.subject}
                    </WidgetWorkPackageTitle>
                    {innerContent}
                </Root>
            </WidgetWrapper>
        </div>
    );
}

export function OpenProjectEventWidget({ data }: { data: OpenProjectContent }) {
    const { ["org.matrix.matrix-hookshot.openproject.work_package"]: pkg } = data;
    const description = pkg?.description?.html ?? pkg?.description.plain ?? "";
    if (!pkg) {
        return null;
    }

    return (
        <div>
            <span>
                Work package <a href={pkg.url}>{pkg.id}</a> created by {pkg.author.name}
            </span>
            <WidgetWrapper>
                <WidgetBorder style={{ background: pkg?.type.color }} />
                <Root>
                    <WidgetWorkPackageTitle href={pkg.url}>
                        #{pkg.id} {pkg.subject}
                    </WidgetWorkPackageTitle>
                    {description && <WidgetDescription dangerouslySetInnerHTML={{ __html: description }} />}
                    <WidgetRow>
                        <span>
                            <WidgetWorkPackageStatus style={{ background: pkg.status.color }} />
                            {pkg.status.name}
                        </span>
                        <span>{pkg.type.name}</span>
                        {pkg.assignee?.name ? <span>Assigned to {pkg.assignee.name}</span> : null}
                        <span>
                            Created by <a href={pkg.author.url}>{pkg.author.name}</a>
                        </span>
                    </WidgetRow>
                    <Button Icon={PopOutIcon} as="a" size="sm" kind="secondary" href={pkg.url} target="_blank">
                        View package
                    </Button>
                </Root>
            </WidgetWrapper>
        </div>
    );
}
