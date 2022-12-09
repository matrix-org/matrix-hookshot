import { FunctionComponent } from "preact";
import { JSXInternal } from "preact/src/jsx";

export const EventHookCheckbox: FunctionComponent<{
    enabledHooks?: string[],
    onChange: JSXInternal.GenericEventHandler<HTMLInputElement>,
    eventName: string,
    parentEvent?: string,
}> = ({enabledHooks, onChange, eventName, parentEvent, children}) => {
    if (!enabledHooks) {
        throw Error(`Invalid configuration for checkbox ${eventName}`);
    }

    const disabled = !!(parentEvent && !enabledHooks.includes(parentEvent));
    const checked = enabledHooks.includes(eventName);

    return <li>
        <label>
            <input
            disabled={disabled}
            type="checkbox"
            x-event-name={eventName}
            checked={checked}
            onChange={onChange} />
            { children }
        </label>
    </li>;
};