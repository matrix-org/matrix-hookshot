import { styled } from "styled-components";



export interface OpenProjectContent {
    'org.matrix.matrix-hookshot.openproject.work_package'?: {
        id: number,
        subject: string,
        description: {
            plain: string,
            html: string,
        }|string,
        url: string,
        author: {
            name: string,
            url: string,
        },
        assignee?: {
            name: string,
            url: string,
        },
        status: {
            name: string,
            color: string,
        },
        type: {
            name: string,
            color: string,
        }
    },
    'org.matrix.matrix-hookshot.openproject.project'?: {
        id: number,
        name: string,
        url: string,
    },
    "org.matrix.matrix-hookshot.commands": {
      "org.matrix.matrix-hookshot.openproject.command.close": {
        label: "Close work package",
        identifier: string,
        workpackage_id: number,
      },
      "org.matrix.matrix-hookshot.openproject.command.flag": {
        label: "Flag work package",
        identifier: string,
        workpackage_id: number,
      },
    },
}

const Root = styled.div`
    margin-top: var(--cpd-space-2x);
    gap: var(--cpd-space-2x);
    display: flex;
    flex-direction: column;
`

const WidgetProject = styled.div`
    font: var(--cpd-font-body-md-regular);
    font-weight: var(--cpd-font-weight-semibold);
`

const WidgetWorkPackageStatus = styled.div`
    background: var(--cpd-color-gray-200);
    border-radius: var(--cpd-space-2x);
    padding: var(--cpd-space-2x);
    font-weight: var(--cpd-font-weight-semibold);
`

const WidgetWorkPackageTitle = styled.div`
    display: flex;
    flex-direction: row;
    gap: var(--cpd-space-2x);
    > * {
        margin-top: auto;
        margin-bottom: auto;
    }
`;

export function OpenProjectEventWidget({data}: {data: OpenProjectContent}) {
    const topicToHtml = (...args: any) => args[0];
    const { ["org.matrix.matrix-hookshot.openproject.work_package"]: pkg, ["org.matrix.matrix-hookshot.openproject.project"]: project } = data;
    const description = pkg?.description && (typeof pkg.description === "string" ? topicToHtml(pkg.description ?? "No description") : topicToHtml(pkg.description.plain ?? "No description", pkg.description.html, undefined, true));
    return <Root>
        {project && <WidgetProject>
            <a href={project.url}>{project.name}</a>
        </WidgetProject>}
        {pkg && <div>
            <WidgetWorkPackageTitle>
                <WidgetWorkPackageStatus className="mx_OpenProjectEventWidgetWorkPackageStatus" style={{color: pkg.type.color}}>{pkg.type.name}</WidgetWorkPackageStatus>
                <WidgetWorkPackageStatus className="mx_OpenProjectEventWidgetWorkPackageStatus" style={{color: pkg.status.color}}>{pkg.status.name}</WidgetWorkPackageStatus>
                <a href={pkg.url}>{pkg.subject}</a>
                <span>{pkg.id}</span>
                <span>by <a href={pkg.author.url}>{pkg.author.name}</a></span>
            </WidgetWorkPackageTitle>
            <p>{description}</p>
        </div>}
    </Root>;
}