try {
    // In production, we expect it co-located
    module.exports = require('./matrix-hookshot-rs.node');
} catch (ex) {
    // When running under ts-node, it may not be co-located.
    module.exports = require('../lib/matrix-hookshot-rs.node');
}
