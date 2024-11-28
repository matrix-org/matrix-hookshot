try {
    // In production, we expect it co-located
    module.exports = require('./matrix-hookshot-rs.node');
} catch (ex) {
    try {
        // When running under ts-node, it may not be co-located.
        module.exports = require('../lib/matrix-hookshot-rs.node');
    } catch (ex) {
        // Or in a test environment.
        module.exports = require('../../lib/matrix-hookshot-rs.node');
    }
}
