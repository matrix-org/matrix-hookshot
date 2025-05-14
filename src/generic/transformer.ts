import {
  QuickJSWASMModule,
  newQuickJSWASMModule,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten";

const TRANSFORMATION_TIMEOUT_MS = 500;

interface Mentions {
  user_ids?: string[];
  room?: boolean;
}

interface FunctionResultObject {
  version: string;
  plain?: string;
  html?: string;
  msgtype?: string;
  empty?: boolean;
  webhookResponse?: ExecuteResultWebhookResponse;
  mentions?: Mentions;
}

export interface ExecuteResultWebhookResponse {
  body: string;
  contentType?: string;
  statusCode?: number;
}

export interface ExecuteResultContent {
  plain: string;
  html?: string;
  msgtype?: string;
  mentions?: Mentions;
}

export interface ExecuteResult {
  content?: ExecuteResultContent;
  webhookResponse?: ExecuteResultWebhookResponse;
}

export class WebhookTransformer {
  private static quickModule?: QuickJSWASMModule;

  public static get canTransform() {
    return !!this.quickModule;
  }

  public static async initialiseQuickJS() {
    WebhookTransformer.quickModule = await newQuickJSWASMModule();
  }

  public static validateScript(scriptSrc: string): string | null {
    const ctx = this.quickModule!.newContext();
    try {
      const codeEvalResult = ctx.evalCode(
        `function f(data) {${scriptSrc}}`,
        undefined,
        { compileOnly: true },
      );
      try {
        if (codeEvalResult.error) {
          const errorString = JSON.stringify(
            ctx.dump(codeEvalResult.error),
            null,
            2,
          );
          return errorString;
        }
      } finally {
        codeEvalResult.dispose();
      }
    } finally {
      ctx.dispose();
    }
    return null;
  }

  constructor(private readonly scriptSrc: string) {}

  public execute(data: unknown): ExecuteResult {
    let result;
    const ctx = WebhookTransformer.quickModule!.newContext();
    ctx.runtime.setInterruptHandler(
      shouldInterruptAfterDeadline(Date.now() + TRANSFORMATION_TIMEOUT_MS),
    );
    try {
      ctx.setProp(ctx.global, "HookshotApiVersion", ctx.newString("v2"));
      const ctxResult = ctx.evalCode(
        `const data = ${JSON.stringify(data)};\n(() => { ${this.scriptSrc} })();`,
      );

      if (ctxResult.error) {
        const e = Error(
          `Transformation failed to run: ${JSON.stringify(ctx.dump(ctxResult.error))}`,
        );
        ctxResult.error.dispose();
        throw e;
      } else {
        const value = ctx.getProp(ctx.global, "result");
        result = ctx.dump(value);
        value.dispose();
        ctxResult.value.dispose();
      }
    } finally {
      ctx.global.dispose();
      ctx.dispose();
    }

    // Legacy v1 api
    if (typeof result === "string") {
      return { content: { plain: `Received webhook: ${result}` } };
    } else if (typeof result !== "object") {
      return { content: { plain: `No content` } };
    }
    const transformationResult = result as FunctionResultObject;
    if (transformationResult.version !== "v2") {
      throw Error(
        "Result returned from transformation didn't specify version = v2",
      );
    }

    if (transformationResult.webhookResponse) {
      if (typeof transformationResult.webhookResponse.body !== "string") {
        throw Error(
          "Result returned from transformation didn't provide a string value for webhookResponse.body",
        );
      }
      if (
        transformationResult.webhookResponse.statusCode !== undefined &&
        typeof transformationResult.webhookResponse.statusCode !== "number" &&
        Number.isInteger(transformationResult.webhookResponse.statusCode)
      ) {
        throw Error(
          "Result returned from transformation didn't provide a number value for webhookResponse.statusCode",
        );
      }
      if (
        transformationResult.webhookResponse.contentType !== undefined &&
        typeof transformationResult.webhookResponse.contentType !== "string"
      ) {
        throw Error(
          "Result returned from transformation didn't provide a contentType value for msgtype",
        );
      }
    }

    if (transformationResult.empty) {
      return {
        content: undefined,
        webhookResponse: transformationResult.webhookResponse,
      };
    }
    if (typeof transformationResult.plain !== "string") {
      throw Error(
        "Result returned from transformation didn't provide a string value for plain",
      );
    }
    if (
      transformationResult.html !== undefined &&
      typeof transformationResult.html !== "string"
    ) {
      throw Error(
        "Result returned from transformation didn't provide a string value for html",
      );
    }
    if (
      transformationResult.msgtype !== undefined &&
      typeof transformationResult.msgtype !== "string"
    ) {
      throw Error(
        "Result returned from transformation didn't provide a string value for msgtype",
      );
    }
    if (transformationResult.mentions) {
      if (
        transformationResult.mentions.room !== undefined &&
        typeof transformationResult.mentions.room !== "boolean"
      ) {
        throw Error(
          "Result returned from transformation provided an invalid mentions.room",
        );
      }
      if (
        transformationResult.mentions.user_ids !== undefined &&
        !Array.isArray(transformationResult.mentions.user_ids)
      ) {
        throw Error(
          "Result returned from transformation provided an invalid mentions.user_ids",
        );
      }
      // Sanitise
      transformationResult.mentions = {
        room: transformationResult.mentions.room,
        user_ids: transformationResult.mentions.user_ids,
      };
    }

    return {
      content: {
        plain: transformationResult.plain,
        html: transformationResult.html,
        msgtype: transformationResult.msgtype,
        mentions: transformationResult.mentions,
      },
      webhookResponse: transformationResult.webhookResponse,
    };
  }
}
