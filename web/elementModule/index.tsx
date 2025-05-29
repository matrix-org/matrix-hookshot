/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/


import { type Module, type Api, type ModuleFactory, CustomComponentTarget } from "@element-hq/element-web-module-api";
import { OpenProjectContent, OpenProjectEventWidget } from "./eventWidget";

declare global {
    interface Window {
        // XXX: temporary hack until we rewrite everything in modern modules
        mxMatrixClientPeg: {
            safeGet(): {
                getSafeUserId(): string;
                sendEvent(roomId: string, threadIdOrEventType: string, eventTypeOrContent: string|object, contentOrTxnId?: string|object, txnIdOrVoid?: string): Promise<string>;
            };
        };
    }
}

class HookshotModule implements Module {
    public static readonly moduleApiVersion = "^1.0.0";

    public constructor(private api: Api) {
    }

    public async load(): Promise<void> {
        this.api.customComponents.register(CustomComponentTarget.TextualBody, (props) => {
            const content = props.mxEvent.getContent();
            const workPackageData = content["org.matrix.matrix-hookshot.openproject.work_package"];
            if (!workPackageData) {
                return null;
            }
            return <OpenProjectEventWidget data={content}/>;
        })
        this.api.customComponents.register(CustomComponentTarget.MessageContextMenu, ({ mxEvent, closeMenu}, originalComponent) => {
            const content = mxEvent.getContent() as OpenProjectContent;
            const workPackageData = content["org.matrix.matrix-hookshot.openproject.work_package"];
            if (!workPackageData) {
                return null;
            }
            const client = window.mxMatrixClientPeg.safeGet();
            
            return <>
                {this.api.customComponents.buildContextMenuBlock(
                    Object.entries(content["org.matrix.matrix-hookshot.commands"] ?? {}).map(([commandName, details]) => ({
                        label: details.label,
                        iconClassName: 'mx_MessageContextMenu_iconReport',
                        onClick: async () => {
                            await client.sendEvent(mxEvent.getRoomId(), 'org.matrix.matrix-hookshot.command', {
                                command: commandName,
                                "m.relates_to": {
                                    rel_type: "org.matrix-hooshot.command-target",
                                    event_id: mxEvent.getId(),
                                },
                            })
                            closeMenu()
                        },
                    }))
                )}
                {originalComponent}
            </>
        })
    }
}

export default HookshotModule satisfies ModuleFactory;
