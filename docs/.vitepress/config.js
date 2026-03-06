import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Citadel',
  description: 'Enterprise DayZ server management platform — web UI, Discord bot, and in-game admin mod.',
  base: '/DayzServerController/',
  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
  ],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/DayzServerController/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#7c3aed' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Citadel Docs' }],
    ['meta', { property: 'og:description', content: 'Enterprise DayZ server management platform' }],
  ],

  themeConfig: {
    logo: '/citadel-logo.svg',
    siteTitle: 'Citadel',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/api' },
      { text: 'Changelog', link: '/changelog' },
      { text: '💚 Purchase', link: '/purchase' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Citadel?', link: '/guide/what-is-citadel' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/guide/architecture' },
          ],
        },
        {
          text: 'Installation',
          items: [
            { text: 'Prerequisites', link: '/guide/prerequisites' },
            { text: 'Backend Setup', link: '/guide/backend-setup' },
            { text: 'Frontend Setup', link: '/guide/frontend-setup' },
            { text: 'DayZ Mod Setup', link: '/guide/dayz-mod-setup' },
            { text: 'Discord Bot', link: '/guide/discord-bot' },
          ],
        },
        {
          text: 'Configuration',
          items: [
            { text: 'Environment Variables', link: '/guide/environment-variables' },
            { text: 'Server Profiles', link: '/guide/server-profiles' },
            { text: 'Scheduler & Tasks', link: '/guide/scheduler' },
            { text: 'Notifications', link: '/guide/notifications' },
          ],
        },
        {
          text: 'Monetization',
          items: [
            { text: 'VIP Store', link: '/guide/vip-store' },
            { text: 'Remote Access', link: '/guide/remote-access' },
          ],
        },
        {
          text: 'Operations',
          items: [
            { text: 'RCON Commands', link: '/guide/rcon' },
            { text: 'Backups', link: '/guide/backups' },
            { text: 'Mod Management', link: '/guide/mod-management' },
            { text: 'Player Management', link: '/guide/player-management' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'REST API', link: '/reference/api' },
            { text: 'WebSocket Events', link: '/reference/websocket' },
            { text: 'Sidecar API', link: '/reference/sidecar-api' },
          ],
        },
        {
          text: 'Internals',
          items: [
            { text: 'Provider System', link: '/reference/providers' },
            { text: 'Server Actions', link: '/reference/server-actions' },
            { text: 'Data Store', link: '/reference/data-store' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Sk3tch-Dev-Ux/DayzServerController' },
    ],

    editLink: {
      pattern: 'https://github.com/Sk3tch-Dev-Ux/DayzServerController/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Citadel Contributors',
    },

    search: {
      provider: 'local',
    },
  },
});
