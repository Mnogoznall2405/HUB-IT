const { buildAndroidHttpsAppLinksConfig } = require('../../android-app-links.cjs') as {
  buildAndroidHttpsAppLinksConfig: (value: string | undefined) => Record<string, unknown>;
};

describe('Android HTTPS App Links build policy', () => {
  it.each([undefined, '', '0', 'true', 'yes'])('keeps preview builds out of the Android HTTPS resolver for %s', (value) => {
    expect(buildAndroidHttpsAppLinksConfig(value)).toEqual({});
  });

  it('enables verified HUB links only after an explicit release opt-in', () => {
    expect(buildAndroidHttpsAppLinksConfig('1')).toEqual({
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'https', host: 'hubit.zsgp.ru', pathPrefix: '/' }],
        },
      ],
    });
  });
});
