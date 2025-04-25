import { Appservice, type IAppserviceRegistration } from "matrix-bot-sdk";
import {
    GenericContainer,
    Wait,
    AbstractStartedContainer,
    type StartedTestContainer,
    TestContainers,
    Network,
    StartedNetwork,
} from "testcontainers";
import { RedisContainer, StartedRedisContainer } from "@testcontainers/redis";
import YAML from "yaml";
import { randomUUID } from  "node:crypto";

const DEFAULT_SYNAPSE_IMAGE = process.env.SYNAPSE_IMAGE || "ghcr.io/element-hq/synapse:latest";

const DEFAULT_SIGNING_KEY = "ed25519 a_DTli HDSh+iM94MpMlvoebjuY3hqmHi/CU7j8kANUsq1gjws";

export interface TestContainerNetwork {
    network: StartedNetwork;
    synapse: StartedSynapseContainer;
    redis: StartedRedisContainer;
    registration: IAppserviceRegistration;
}

// Sets up a Synapse homeserver in a test container
export class SynapseContainer extends GenericContainer {
    // List of appservice registration files copied to the container
    private appserviceFiles: Set<string> = new Set();

    // List of federation CA files copied to the container
    private federationCaFiles: Set<string> = new Set();

    // TLS certificate and key files
    private tls: { certPath: string; keyPath: string } | null = null;

    // Signing key to use for the server
    public readonly signingKey: string;

    // Registration secret to use for the server
    public readonly registrationSecret: string;

    constructor(
        public readonly serverName: string,
        opts: {
            signingKey?: string;
            registrationSecret?: string;
            image?: string;
            crypto?: Crypto;
        } = {},
    ) {
        super(opts.image ?? DEFAULT_SYNAPSE_IMAGE);
        this.withNetworkAliases(serverName)
            .withExposedPorts(8008)
            .withWaitStrategy(Wait.forHttp("/_matrix/client/versions", 8008))
            .withEnvironment({ SERVER_NAME: serverName });

        this.signingKey = opts.signingKey ?? DEFAULT_SIGNING_KEY;
        this.registrationSecret = randomUUID();
    }

    // Add a custom appservice registration to the container
    public withAppServiceRegistration(
        registration: IAppserviceRegistration,
    ): SynapseContainer {
        const target = `/__conf/appservices/${randomUUID()}.yaml`;
        const content = YAML.stringify(registration);
        this.withCopyContentToContainer([{ content, target }]);
        this.appserviceFiles.add(target);

        return this;
    }

    private generateConfig(): any {
        const listeners = [
            {
                port: 8008,
                bind_addresses: ["::"],
                type: "http",
                tls: false,
                x_forwarded: false,
                resources: [{ names: ["client", "federation"] }],
            },
        ];

        if (this.tls) {
            listeners.push({
                port: 8448,
                bind_addresses: ["::"],
                type: "http",
                tls: true,
                x_forwarded: false,
                resources: [{ names: ["client", "federation"] }],
            });
        }

        const rc = { per_second: 9999, burst_count: 9999 };

        const config: any = {
            server_name: this.serverName,
            signing_key: this.signingKey,
            listeners,
            report_stats: false,
            trusted_key_servers: [],
            enable_registration: false,
            bcrypt_rounds: 4,
            registration_shared_secret: this.registrationSecret,
            app_service_config_files: Array.from(this.appserviceFiles),

            // Disable the media repo, as it requires mounting a volume
            enable_media_repo: false,

            // unblacklist RFC1918 addresses
            federation_ip_range_blacklist: [],

            // Use an in-memory SQLite database
            database: {
                name: "sqlite3",
                args: { database: ":memory:" },
            },

            // Set generous rate limits
            rc_federation: {
                window_size: 1000,
                sleep_limit: 10,
                sleep_delay: 500,
                reject_limit: 99999,
                concurrent: 3,
            },
            rc_message: rc,
            rc_registration: rc,
            rc_login: {
                address: rc,
                account: rc,
                failed_attempts: rc,
            },
            rc_admin_redaction: rc,
            rc_joins: {
                local: rc,
                remote: rc,
            },
            rc_joins_per_room: rc,
            rc_3pid_validation: rc,
            rc_invites: {
                per_room: rc,
                per_user: rc,
            },
            federation_rr_transactions_per_room_per_second: 9999,
        };

        if (this.federationCaFiles.size > 0) {
            config["federation_custom_ca_list"] = Array.from(
                this.federationCaFiles,
            );
        }

        if (this.tls) {
            config["tls_certificate_path"] = this.tls.certPath;
            config["tls_private_key_path"] = this.tls.keyPath;
        }

        return config;
    }

    public override async beforeContainerCreated(): Promise<void> {
        // Just before the container is created, generate the config file
        // and set the environment variable to point to it
        const config = this.generateConfig();
        const target = "/__conf/config.yaml";
        const content = YAML.stringify(config);
        this.withCopyContentToContainer([{ content, target }]);
        this.withEnvironment({ SYNAPSE_CONFIG_PATH: target });
    }

    public override async start(): Promise<StartedSynapseContainer> {
        return new StartedSynapseContainer(
            this.serverName,
            this.registrationSecret,
            this.signingKey,
            await super.start(),
        );
    }
}

export class StartedSynapseContainer extends AbstractStartedContainer {
    constructor(
        public readonly serverName: string,
        public readonly registrationSecret: string,
        public readonly sigingKey: string,
        startedTestContainer: StartedTestContainer,
    ) {
        super(startedTestContainer);
    }

    public get baseUrl(): string {
        const port = this.getMappedPort(8008);
        const host = this.getHost();
        return `http://${host}:${port}/`;
    }
}

export async function createContainers(name: string, hookshotPort: number): Promise<TestContainerNetwork> {
    // Before doing anything, make sure we have the port forwarder running
    // Even though the port list to expose is empty, this has the side effect of starting the port forwarder
    await TestContainers.exposeHostPorts(hookshotPort);
    
    // Start a docker network which will hold all the containers
    const network = await new Network().start();

    const registration = {
        id: "hookshot",
        hs_token: "hs_hs_token",
        as_token: "hs_as_token",
        url: `http://host.testcontainers.internal:${hookshotPort}`,
        sender_localpart: "hookshot",
        rate_limited: false,
        namespaces: {
            rooms: [],
            users: [{ regex: "@hookshot_.*:hookshot", exclusive: false }],
            aliases: [],
        },
    } satisfies IAppserviceRegistration;

    const container = await new SynapseContainer(name, { crypto })
        .withNetwork(network)
        .withAppServiceRegistration(registration)
        .start();

    const appService = new Appservice({
        bindAddress: "0.0.0.0",
        port: hookshotPort,
        homeserverName: container.serverName,
        homeserverUrl: container.baseUrl,
        registration,
    });

    // Setup the appservice ping endpoint
    appService.expressAppInstance.post(
        "/_matrix/app/v1/ping",
        (_req, res) => res.status(200).send({}),
    );

    // Patch the "begin" function to expose host ports, and ping the appservice
    // The reason we don't do this unconditionally, is that if we never start the appservice,
    // the HS will try to contact it, which will throw an exception on the local process if port was exposed,
    // which mocha will catch and report as a test failure.
    const originalBegin = appService.begin.bind(appService);
    appService.begin = async () => {
        await originalBegin();

        // It looks like having the port forwarder setup before
        // we actually start the appservice sometimes causes issues
        await TestContainers.exposeHostPorts(hookshotPort);

        // Ask the HS to ping the appservice
        await appService.botClient.doRequest(
            "POST",
            `/_matrix/client/v1/appservice/${registration.id}/ping`,
            null,
            {},
        );
    };

    // This silences the "too many listeners" warning when reusing the appservice
    appService.setMaxListeners(Infinity);
    const redis = await new RedisContainer().withNetwork(network).start();

    return {
        registration,
        network,
        synapse: container,
        redis
    };
}
