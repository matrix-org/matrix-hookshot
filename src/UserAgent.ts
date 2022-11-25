import { getBridgeVersion } from "matrix-appservice-bridge";

const UserAgent = `matrix-hookshot/${getBridgeVersion()} (+https://github.com/matrix-org/matrix-hookshot)`;
export default UserAgent;
