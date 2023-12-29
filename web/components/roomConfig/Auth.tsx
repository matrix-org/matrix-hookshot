import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import { GetAuthResponse } from "../../../src/Widgets/BridgeWidgetInterface";
import { Button } from "../elements";
import { BridgeContext } from "../../context";

const PollAuthEveryMs = 3000;


export const ServiceAuth = ({
    service,
    loginLabel = "Log in",
    authState,
    onAuthSucceeded,
}: {
    service: string,
    authState: GetAuthResponse,
    onAuthSucceeded: () => void,
    loginLabel?: string,
}) => {
    const api = useContext(BridgeContext).bridgeApi;
    const [pollStateId, setPollStateId] = useState<string|null>();

    const pollAuth = useCallback(async (pollId) => {
        try {
            const res = await api.getAuthPoll(service, pollId);
            if (res.state === "waiting") {
                // Keep going
                return;
            }
            // Completed.
            setPollStateId(null);
            onAuthSucceeded();
        } catch (ex) {
            console.warn(`Failed to poll for state check`, ex);
        }
    }, [service, api, onAuthSucceeded])

    useEffect(() => {
        if (!pollStateId) {
            return;
        }
        let pollTimerId: number;
        const poll = async () => {
            try {
                await pollAuth(pollStateId);
            }
            finally {
                // Recursively call poll
                pollTimerId = window.setTimeout(
                    poll,
                    PollAuthEveryMs,
                );
            }
        };
        void poll();

        // Cleanup
        return () => {
            window.clearTimeout(pollTimerId);
        };

    }, [api, service, pollStateId, onAuthSucceeded, pollAuth]);

    const loginToService = useCallback(() => {
        if (authState.authenticated) {
            // No need to do anything
            return;
        }
        window.open(authState.authUrl, '_blank');
        setPollStateId(authState.stateId);
    }, [authState]);

    const logoutOfService = useCallback(() => {
        if (!authState.authenticated) {
            // No need to do anything
            return;
        }
        api.serviceLogout(service).then(() => {
            onAuthSucceeded();
        }).catch((ex) => {
            console.warn(`Failed to poll for state check`, ex);
        })
    }, [api, onAuthSucceeded, service, authState]);

    if ('authUrl' in authState) {
        return <Button onClick={loginToService}>
            { loginLabel }
        </Button>;
    }
    return <p>
        Logged in as <strong>{authState.user?.name ?? ''}</strong>. <a href="#" onClick={logoutOfService}>Logout</a>
    </p>;
};
