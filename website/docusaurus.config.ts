import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const organizationName = 'anthony-c-martin';
const projectName = 'bicep-extensions';

const config: Config = {
  title: 'Bicep Extensions',
  tagline: 'A catalogue of Bicep extensions and the resource types they expose',
  favicon: 'img/favicon.ico',

  url: `https://${organizationName}.github.io`,
  baseUrl: `/${projectName}/`,
  organizationName,
  projectName,
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    // Treat .md as CommonMark so generated content containing characters such as
    // `<` and `{` does not need escaping for MDX.
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      // Follow the operating system's light/dark preference, with no manual
      // toggle in the navbar.
      respectPrefersColorScheme: true,
      disableSwitch: true,
    },
    navbar: {
      title: 'Bicep Extensions',
      logo: {
        alt: 'Bicep Extensions',
        src: 'img/logo.svg',
      },
      items: [
        { to: '/docs/guides/getting-started', label: 'Getting started', position: 'left' },
        { to: '/docs/extensions', label: 'Catalogue', position: 'left' },
        {
          href: `https://github.com/${organizationName}/${projectName}`,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    // No footer: its links live in the navbar and the Getting started guide,
    // and it consumed a lot of vertical space on the dense reference pages.
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bicep', 'json', 'bash'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
