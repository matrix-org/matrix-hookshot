import * as React from "react";
import type {
  Api,
  CustomMessageComponentProps,
  Module,
  ModuleFactory,
} from "@element-hq/element-web-module-api";
import {
  OpenProjectEventWidget,
  OpenProjectEventWidgetChanged,
  type OpenProjectContent,
} from "./components/OpenProject";

class HookshotOpenProjectModule implements Module {
  public static readonly moduleApiVersion = "^1.0.0";

  public constructor(private readonly api: Api) {}

  public async load(): Promise<void> {
    function shouldRender(
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      const content = mxEvent.content;
      return !!content["org.matrix.matrix-hookshot.openproject.work_package"];
    }

    this.api.customComponents.registerMessageRenderer(
      shouldRender,
      (props) => {
        const content = props.mxEvent.content;
        if (
          content["org.matrix.matrix-hookshot.openproject.work_package.changed"]
        ) {
          return (
            <OpenProjectEventWidgetChanged
              data={content as OpenProjectContent}
            />
          );
        }
        return <OpenProjectEventWidget data={content as OpenProjectContent} />;
      },
      { allowEditingEvent: false },
    );
  }
}

export default HookshotOpenProjectModule satisfies ModuleFactory;
