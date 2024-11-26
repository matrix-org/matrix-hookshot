import { FunctionComponent } from "preact";
import { JSXInternal } from "preact/src/jsx";

export const EventHookCheckbox: FunctionComponent<{
    enabledHooks: string[],
    onChange: JSXInternal.GenericEventHandler<HTMLInputElement>,
    hookEventName: string,
    parentEvent?: string,
}> = ({enabledHooks, onChange, hookEventName, parentEvent, children}) => {
    const checked = enabledHooks.includes(hookEventName) || (!!parentEvent && enabledHooks.includes(parentEvent));

    return <li>
        <label>
            <input
            type="checkbox"
            data-event-name={hookEventName}
            checked={checked}
            onChange={onChange} />
            { children }
        </label>
    </li>;
};