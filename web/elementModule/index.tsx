/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { Module, Api, ModuleFactory, CustomMessageComponentProps } from "@element-hq/element-web-module-api";
import { type OpenProjectContent, OpenProjectEventWidget, OpenProjectEventWidgetChanged } from "./OpenProject";


class HookshotModule implements Module {
    public static readonly moduleApiVersion = "^1.0.0";

    public constructor(private api: Api) {}

    public async load(): Promise<void> {
        function shouldRender(mxEvent: CustomMessageComponentProps["mxEvent"]): boolean {
            if (mxEvent.getType() !== "m.room.message") {
                return false;
            }
            const content = mxEvent.getContent();
            const workPackageData = content["org.matrix.matrix-hookshot.openproject.work_package"];
            return !!workPackageData;
        }

        this.api.customComponents.registerMessageRenderer(shouldRender, (props, originalComponent) => {
            const content = props.mxEvent.getContent();
            if (content["org.matrix.matrix-hookshot.openproject.work_package.changed"]) {
                return <OpenProjectEventWidgetChanged data={content as OpenProjectContent} />;
            }
            return <OpenProjectEventWidget data={content as OpenProjectContent} />;
        }, { allowEditingEvent: false });
        // NOT IMPLEMENTED YET
        // this.api.menuApi.registerMessageMenuItems(
        //     MessageMenuTarget.TimelineTileContextMenu,
        //     (mxEvent) => {
        //         const client = this.api.matrixClient;
        //         const content = mxEvent.getContent() as OpenProjectContent;
        //         const workPackageData = content["org.matrix.matrix-hookshot.openproject.work_package"];
        //         if (!workPackageData) {
        //             return [];
        //         }
        //         return Object.entries(content["org.matrix.matrix-hookshot.commands"] ?? {}).map<MenuItem>(
        //             ([commandName, details]) => ({
        //                 label: details.label,
        //                 icon: "mx_MessageContextMenu_iconReport",
        //                 onClick: async (closeMenu) => {
        //                     await client.sendEvent(
        //                         mxEvent.getRoomId()!,
        //                         "org.matrix.matrix-hookshot.command" as any,
        //                         {
        //                             "command": commandName,
        //                             "m.relates_to": {
        //                                 rel_type: "org.matrix-hooshot.command-target",
        //                                 event_id: mxEvent.getId(),
        //                             },
        //                         },
        //                     );
        //                     closeMenu();
        //                 },
        //             }),
        //         );
        //     }
        // );
    }
}

export default HookshotModule satisfies ModuleFactory;
