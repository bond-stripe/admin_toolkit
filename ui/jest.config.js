/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const UIExtensionsConfig = require('@stripe/ui-extension-tools/jest.config.ui-extension');

// The SDK test renderer pins react@18.3.1. A second React copy makes the hooks
// dispatcher null ("Cannot read properties of null (reading 'useMemo')").
// react isn't a direct dep here, so resolve the SDK's own copy and force
// everything onto it for the whole test run.
const sdkDir = path.dirname(require.resolve('@stripe/ui-extension-sdk/package.json'));
const reactPath = path.dirname(require.resolve('react/package.json', { paths: [sdkDir] }));

module.exports = {
  ...UIExtensionsConfig,
  moduleNameMapper: {
    ...(UIExtensionsConfig.moduleNameMapper || {}),
    '^react$': reactPath,
  },
};
