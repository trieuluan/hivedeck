import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.author ? `${key}:${String(params.author)}` : key,
  }),
}));

import {
  PluginAvatar,
  pluginAvatarTone,
  pluginInitials,
  resolvePluginLogoUrl,
  resolvePluginSourceLogoUrl,
  resolvePluginSourceOwner,
} from './PluginAvatar';
import {
  MarketplacePluginCard,
  type CatalogPlugin,
} from './MarketplaceCatalog';

const samplePlugin = (patch: Partial<CatalogPlugin> = {}): CatalogPlugin => ({
  name: 'feature-dev',
  description: 'Comprehensive feature development workflow.',
  version: '1.2.0',
  icon: null,
  logo: null,
  author: 'Anthropic',
  source: { source: 'url', url: 'https://github.com/anthropics/feature-dev' },
  marketplace: 'anthropics/claude-plugins-official',
  tags: ['workflow', 'agents'],
  components: ['mcpServers', 'hooks'],
  install_source: 'marketplace+https://github.com/anthropics/feature-dev.git#',
  install_commit: null,
  ...patch,
});

describe('resolvePluginLogoUrl', () => {
  it('accepts https, http, and single-slash relative URLs', () => {
    expect(resolvePluginLogoUrl('https://example.com/icon.png')).toBe(
      'https://example.com/icon.png'
    );
    expect(resolvePluginLogoUrl(null, 'http://example.com/logo.svg')).toBe(
      'http://example.com/logo.svg'
    );
    expect(resolvePluginLogoUrl('/assets/plugin.png')).toBe(
      '/assets/plugin.png'
    );
  });

  it('rejects empty, protocol-relative, and unsafe URLs', () => {
    expect(resolvePluginLogoUrl(null, undefined)).toBeNull();
    expect(resolvePluginLogoUrl('   ')).toBeNull();
    expect(resolvePluginLogoUrl('//cdn.example.com/x.png')).toBeNull();
    expect(resolvePluginLogoUrl('javascript:alert(1)')).toBeNull();
    expect(resolvePluginLogoUrl('data:image/png;base64,AAA')).toBeNull();
  });

  it('derives GitHub organization owner and logo URL from plugin source metadata', () => {
    expect(
      resolvePluginSourceOwner(
        'adobe-for-creativity',
        { source: 'git-subdir', url: 'https://github.com/adobe/skills.git' },
        null
      )
    ).toBe('adobe');
    expect(
      resolvePluginSourceLogoUrl(
        '42crunch-api-security',
        null,
        'marketplace+https://github.com/42Crunch-AI/claude-plugins.git#plugins/api'
      )
    ).toBe('https://github.com/42Crunch-AI.png?size=64');
    expect(
      resolvePluginSourceOwner('agent-sdk-dev', './plugins/agent-sdk-dev', null)
    ).toBe('anthropics');
    expect(
      resolvePluginSourceOwner('playwright', './external_plugins/playwright')
    ).toBe('microsoft');
  });
});

describe('pluginInitials', () => {
  it('derives consistent initials from plugin names', () => {
    expect(pluginInitials('feature-dev')).toBe('FD');
    expect(pluginInitials('notion')).toBe('NO');
    expect(pluginInitials('@scope/my-plugin')).toBe('SM');
    expect(pluginInitials('---')).toBe('P');
  });
});

describe('PluginAvatar', () => {
  it('renders an image when a valid icon or logo URL is provided', () => {
    const html = renderToStaticMarkup(
      <PluginAvatar name="feature-dev" icon="https://example.com/icon.png" />
    );
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/icon.png"');
  });

  it('falls back to deterministic initials when icon is missing or invalid', () => {
    const missingHtml = renderToStaticMarkup(
      <PluginAvatar name="feature-dev" />
    );
    expect(missingHtml).not.toContain('<img');
    expect(missingHtml).toContain('>FD<');

    const invalidHtml = renderToStaticMarkup(
      <PluginAvatar name="notion" icon="javascript:alert(1)" />
    );
    expect(invalidHtml).not.toContain('<img');
    expect(invalidHtml).toContain('>NO<');
    expect(pluginAvatarTone('feature-dev')).toBe(
      pluginAvatarTone('feature-dev')
    );
  });
});

describe('MarketplacePluginCard', () => {
  it('renders avatar, name, description, attribution, badges, and actions', () => {
    const html = renderToStaticMarkup(
      <MarketplacePluginCard
        plugin={samplePlugin({ icon: 'https://example.com/fd.png' })}
        installed={false}
        canInstall
        components={['mcpServers', 'hooks']}
        expanded={false}
        onToggleDetails={() => {}}
        onInstall={() => {}}
      />
    );
    expect(html).toContain('feature-dev');
    expect(html).toContain('Comprehensive feature development workflow.');
    expect(html).toContain('settings.plugins.marketplace.byAuthor:Anthropic');
    expect(html).toContain('src="https://example.com/fd.png"');
    expect(html).toContain('settings.plugins.marketplace.allClis');
    expect(html).toContain('settings.plugins.marketplace.claudeOnly');
    expect(html).toContain('settings.plugins.marketplace.install');
    expect(html).toContain('settings.plugins.marketplace.details');
    expect(html).toContain('aria-expanded="false"');
  });

  it('renders missing description fallback and unknown component badge', () => {
    const html = renderToStaticMarkup(
      <MarketplacePluginCard
        plugin={samplePlugin({ description: '   ', author: null })}
        installed={false}
        canInstall={false}
        components={[]}
        expanded={false}
        onToggleDetails={() => {}}
        onInstall={() => {}}
      />
    );
    expect(html).toContain('settings.plugins.marketplace.noDescription');
    expect(html).toContain('anthropics/claude-plugins-official');
    expect(html).toContain('settings.plugins.marketplace.unknown');
  });

  it('renders installed state and expanded detail metadata', () => {
    const html = renderToStaticMarkup(
      <MarketplacePluginCard
        plugin={samplePlugin()}
        installed
        canInstall
        components={['skills']}
        expanded
        onToggleDetails={() => {}}
        onInstall={() => {}}
      />
    );
    expect(html).toContain('settings.plugins.marketplace.installed');
    expect(html).toContain('settings.plugins.marketplace.hideDetails');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('https://github.com/anthropics/feature-dev');
    expect(html).toContain('1.2.0');
    expect(html).toContain('workflow, agents');
  });
});
