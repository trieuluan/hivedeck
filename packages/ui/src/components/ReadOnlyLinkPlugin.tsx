import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $isLinkNode, LinkNode } from '@lexical/link';
import { $getNodeByKey, $nodesOfType } from 'lexical';

const ARTIFACT_FILE_URL_RE =
  /^file:\/\/.*\/\.hivedeck\/artifacts\/([0-9a-fA-F-]{36})\/(.+)$/;

/**
 * Rewrite local `file://.../.hivedeck/artifacts/<issueId>/<path>` links
 * into served `/api/issues/<issueId>/artifacts/file?path=...` URLs so
 * artifact links from agents are clickable in the browser.
 */
function rewriteArtifactFileHref(trimmed: string): string | undefined {
  const match = ARTIFACT_FILE_URL_RE.exec(trimmed);
  if (!match) return undefined;
  const [, issueId, rawPath] = match;
  let decodedPath = rawPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    // Keep rawPath if percent-encoding is malformed
  }
  return `/api/issues/${issueId}/artifacts/file?path=${encodeURIComponent(decodedPath)}`;
}

/**
 * Sanitize href to block dangerous protocols.
 * Returns undefined if the href is blocked.
 */
export function sanitizeHref(href?: string): string | undefined {
  if (typeof href !== 'string') return undefined;
  const trimmed = href.trim();
  // Block dangerous protocols
  if (/^(javascript|vbscript|data):/i.test(trimmed)) return undefined;
  // Rewrite local HiveDeck artifact file:// URLs to API file routes
  const rewrittenArtifact = rewriteArtifactFileHref(trimmed);
  if (rewrittenArtifact) return rewrittenArtifact;
  // Allow anchors and common relative forms (disabled unless they are app routes)
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('/')
  )
    return trimmed;
  // Allow https and local loopback http (HiveDeck / local dev previews)
  if (
    /^https:\/\//i.test(trimmed) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(trimmed)
  )
    return trimmed;
  // Block everything else by default
  return undefined;
}

/**
 * Check if href is safe and meaningful to open in a new tab.
 */
export function isClickableHref(href?: string): boolean {
  if (!href) return false;
  return (
    /^https:\/\//i.test(href) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(href) ||
    /^\/(api|projects|workspaces|artifacts)(\/|$|\?)/.test(href)
  );
}

function applyReadOnlyLinkPolicy(dom: HTMLAnchorElement, rawUrl?: string) {
  const href = rawUrl ?? dom.getAttribute('href') ?? undefined;
  const safeHref = sanitizeHref(href);

  if (!safeHref) {
    dom.removeAttribute('href');
    dom.style.cursor = 'not-allowed';
    dom.style.pointerEvents = 'none';
    return;
  }

  if (isClickableHref(safeHref)) {
    dom.setAttribute('href', safeHref);
    dom.setAttribute('target', '_blank');
    dom.setAttribute('rel', 'noopener noreferrer');
    dom.style.cursor = 'pointer';
    dom.style.pointerEvents = 'auto';
    dom.removeAttribute('aria-disabled');
    dom.onclick = (e) => e.stopPropagation();
  } else {
    dom.removeAttribute('href');
    dom.style.cursor = 'not-allowed';
    dom.style.pointerEvents = 'none';
    dom.setAttribute('role', 'link');
    dom.setAttribute('aria-disabled', 'true');
    dom.title = href ?? '';
  }
}

/**
 * Plugin that handles link sanitization and security attributes in read-only mode.
 * - Blocks dangerous protocols (javascript:, vbscript:, data:)
 * - HTTPS, local loopback HTTP, and app/artifact routes: clickable with target="_blank"
 * - Other internal/relative links (./, ../, #): rendered but not clickable
 */
export function ReadOnlyLinkPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Register a mutation listener to modify link DOM elements
    const unregister = editor.registerMutationListener(
      LinkNode,
      (mutations) => {
        editor.getEditorState().read(() => {
          for (const [nodeKey, mutation] of mutations) {
            if (mutation === 'destroyed') continue;

            const dom = editor.getElementByKey(nodeKey);
            if (!dom || !(dom instanceof HTMLAnchorElement)) continue;
            const node = $getNodeByKey(nodeKey);
            const rawUrl = $isLinkNode(node) ? node.getURL() : undefined;
            applyReadOnlyLinkPolicy(dom, rawUrl);
          }
        });
      }
    );

    // Also handle existing links on mount using LinkNode.getURL() (before Lexical's about:blank DOM sanitization)
    editor.getEditorState().read(() => {
      for (const node of $nodesOfType(LinkNode)) {
        const dom = editor.getElementByKey(node.getKey());
        if (dom instanceof HTMLAnchorElement) {
          applyReadOnlyLinkPolicy(dom, node.getURL());
        }
      }
    });

    return unregister;
  }, [editor]);

  return null;
}
