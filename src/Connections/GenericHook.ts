import { IConnection } from "./IConnection";
import LogWrapper from "../LogWrapper";
import { MessageSenderClient } from "../MatrixSender"
import markdownit from "markdown-it";
import { Script, createContext } from "vm";
import { MatrixEvent } from "../MatrixEvent";

export interface GenericHookConnectionState {
    /**
     * This is ONLY used for display purposes.
     */
    hookId: string;
    transformationFunction?: string;
}

export interface GenericHookAccountData {
    /**
     * This is where the true hook ID is kept.
     */
    hookId: string;
}

const log = new LogWrapper("GenericHookConnection");
const md = new markdownit();

const TRANSFORMATION_TIMEOUT_MS = 2000;

/**
 * Handles rooms connected to a github repo.
 */
export class GenericHookConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.generic.hook";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.generic.hook";

    static readonly EventTypes = [
        GenericHookConnection.CanonicalEventType,
        GenericHookConnection.LegacyCanonicalEventType,
    ];

    public get hookId() {
        return this.accountData.hookId;
    }

    private transformationFunction?: Script;

    constructor(public readonly roomId: string,
        state: GenericHookConnectionState,
        private readonly accountData: GenericHookAccountData,
        private readonly stateKey: string,
        private messageClient: MessageSenderClient,
        private readonly allowJSTransformation: boolean = false) {
            if (state.transformationFunction && allowJSTransformation) {
                this.transformationFunction = new Script(state.transformationFunction);
            }
        }

    public get connectionId() {
        return `${this.roomId}/${GenericHookConnection.CanonicalEventType}/${this.stateKey}`;
    }
    

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GenericHookConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public async onStateUpdate(stateEv: MatrixEvent<unknown>) {
        const state = stateEv.content as GenericHookConnectionState;
        if (state.transformationFunction && this.allowJSTransformation) {
            try {
                this.transformationFunction = new Script(state.transformationFunction);
            } catch (ex) {
                await this.messageClient.sendMatrixText(this.roomId, 'Could not compile transformation function:' + ex);
            }
        }
    }

    public transformHookData(data: Record<string, unknown>): string {
        // Supported parameters https://developers.mattermost.com/integrate/incoming-webhooks/#parameters
        let msg = "";
        if (typeof data.username === "string") {
            // Create a matrix user for this person
            msg = `**${data.username}**: `
        }
        if (typeof data.text === "string") {
            msg = data.text;
        } else {
            msg = `Recieved webhook data:\n\n\`\`\`${JSON.stringify(data, undefined, 2)}\`\`\``;
        }

        // TODO: Transform Slackdown into markdown.
        return msg;
    }

    public async onGenericHook(data: Record<string, unknown>) {
        log.info(`onGenericHook ${this.roomId} ${this.hookId}`);
        let content: string;
        if (!this.transformationFunction) {
            content = this.transformHookData(data);
        } else {
            try {
                const context = createContext({data});
                this.transformationFunction.runInContext(context, {
                    timeout: TRANSFORMATION_TIMEOUT_MS,
                    breakOnSigint: true,
                    filename: `generic-hook.${this.hookId}`,
                });
                if (context.result) {
                    content = `Recieved webhook: ${context.result}`;
                } else {
                    content = `No content`;
                }
            } catch (ex) {
                content = `Webhook recieved but failed to process via transformation function`;
            }
        }

        return this.messageClient.sendMatrixMessage(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            "uk.half-shot.webhook_data": data,
        });

    }

    public toString() {
        return `GenericHookConnection ${this.hookId}`;
    }
}