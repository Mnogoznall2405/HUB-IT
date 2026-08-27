'use strict';

const HUBIT_ANDROID_HTTPS_APP_LINKS_ENV = 'HUBIT_ANDROID_ENABLE_APP_LINKS';

function buildAndroidHttpsAppLinksConfig(value) {
  if (String(value || '').trim() !== '1') return {};

  return {
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'hubit.zsgp.ru', pathPrefix: '/' }],
      },
    ],
  };
}

module.exports = {
  HUBIT_ANDROID_HTTPS_APP_LINKS_ENV,
  buildAndroidHttpsAppLinksConfig,
};
