import { h, FunctionComponent, Fragment } from "preact";
import { useCallback, useState } from "preact/hooks"
import { GetConnectionsResponseItem } from "../../../src/provisioning/api";
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';

const EXAMPLE_SCRIPT = `if (data.counter === undefined) {
    result = {empty: true, version: "v2"};
  } else if (data.counter > data.maxValue) {
      result = {plain: \`**Oh no!** The counter has gone over by \${data.counter - data.maxValue}\`, version: "v2"};
  } else {
      result = {plain: \`*Everything is fine*, the counter is under by\${data.maxValue - data.counter}\`, version: "v2"};
  }`;

export const GenericWebhookConfig: FunctionComponent<{connection: GetConnectionsResponseItem, onSave: () => void, onRemove: () => void}> = ({ connection, onSave, onRemove }) => {

    const [transFn, setTransFn] = useState(connection.config.transformationFunction || EXAMPLE_SCRIPT);
    const [transFnEnabled, setTransFnEnabled] = useState(!!connection.config.transformationFunction);

    return <>
        <main>
            <div>
                <label>Name</label>
                <span>{connection.config.name}</span>
            </div>
            { connection.secrets?.url && <div>
                <label>Url</label>
                <span>{connection.secrets.url}</span>
                </div>}
            <div>
                <p>Transformation Function</p><div>
                <label>Enable</label>
                <input type="checkbox" value={transFnEnabled} onChange={() => setTransFnEnabled(!transFnEnabled)}></input>
                </div>
                { transFnEnabled && <div>
                    <CodeMirror
                        value={transFn}
                        disabled={true}
                        extensions={[javascript({  })]}
                        onChange={(value) => {
                            setTransFn(value)
                        }}
                    />
                    <p> See the <a href="https://matrix-org.github.io/matrix-hookshot/latest/setup/webhooks.html#script-api">documentation</a> for help writing transformation functions </p>
                </div>}
            </div>
        </main>
        <footer>
            <button onClick={onSave}>Save</button>
            <button onRemove={onRemove}>Remove</button>
        </footer>
    </>;
};