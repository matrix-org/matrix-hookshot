// In CI, the network creation for the homerunner containers can race (https://github.com/matrix-org/complement/issues/720).
jest.retryTimes(process.env.CI ? 3 : 1);