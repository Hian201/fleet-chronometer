import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
    binaries: {
        chrome: '/Applications/Helium.app/Contents/MacOS/Helium',
    },
    chromiumProfile: '/Users/hian/kc-monitor-dev-profile',
    keepProfileChanges: true,
});