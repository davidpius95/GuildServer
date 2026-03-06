import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'GuildServer Documentation',
  tagline: 'Enterprise Platform as a Service — Deploy, scale, and manage applications with ease',
  favicon: 'img/favicon.ico',

  url: 'https://docs.guildserver.com',
  baseUrl: '/',

  organizationName: 'guildserver',
  projectName: 'guildserver-paas',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'warn',

  markdown: {
    format: 'detect',
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
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/guildserver/guildserver-paas/tree/main/apps/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/guildserver-social-card.png',

    announcementBar: {
      id: 'beta_notice',
      content:
        'GuildServer PaaS is in active development. <a target="_blank" rel="noopener noreferrer" href="https://github.com/guildserver/guildserver-paas">Star us on GitHub</a> and follow along!',
      backgroundColor: '#10b981',
      textColor: '#ffffff',
      isCloseable: true,
    },

    navbar: {
      title: 'GuildServer',
      logo: {
        alt: 'GuildServer Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Getting Started',
        },
        {
          to: '/api',
          label: 'API Reference',
          position: 'left',
        },
        {
          to: '/dashboard/overview',
          label: 'Dashboard Guide',
          position: 'left',
        },
        {
          href: 'https://github.com/guildserver/guildserver-paas',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },

    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/getting-started',
            },
            {
              label: 'API Reference',
              to: '/api',
            },
            {
              label: 'Self-Hosting',
              to: '/self-hosting/docker-compose',
            },
            {
              label: 'Contributing',
              to: '/contributing/development-setup',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/guildserver/guildserver-paas/discussions',
            },
            {
              label: 'Discord',
              href: 'https://discord.gg/guildserver',
            },
            {
              label: 'Twitter / X',
              href: 'https://twitter.com/guildserver',
            },
          ],
        },
        {
          title: 'Platform',
          items: [
            {
              label: 'Dashboard',
              href: 'https://app.guildserver.com',
            },
            {
              label: 'Status Page',
              href: 'https://status.guildserver.com',
            },
            {
              label: 'Changelog',
              href: 'https://github.com/guildserver/guildserver-paas/releases',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              href: 'https://blog.guildserver.com',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/guildserver/guildserver-paas',
            },
            {
              label: 'License',
              href: 'https://github.com/guildserver/guildserver-paas/blob/main/LICENSE',
            },
          ],
        },
      ],
      copyright: `Copyright \u00a9 ${new Date().getFullYear()} GuildServer. Built with Docusaurus.`,
    },

    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'docker', 'nginx', 'sql', 'toml'],
    },

    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
