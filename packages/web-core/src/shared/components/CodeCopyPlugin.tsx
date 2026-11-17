import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { CodeNode } from '@lexical/code';
import { $getNodeByKey } from 'lexical';
import { useTranslation } from 'react-i18next';
import { writeClipboardViaBridge } from '@/shared/lib/clipboard';

// Phosphor Copy / Check (regular), inlined: the button is plain DOM.
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a11.31,11.31,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>';

/**
 * Copy buttons on read-only code blocks.
 *
 * The button is plain DOM appended to Lexical's code element, not a React
 * portal: Lexical owns that element and may drop it (re-render, unmount)
 * before React would unmount a portal, which made React's own cleanup
 * throw "removeChild: the node to be removed is not a child of this node"
 * and crash the app when leaving a chat that showed code.
 */
export function CodeCopyPlugin() {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation('common');

  useEffect(() => {
    const added = new Set<HTMLButtonElement>();

    const attach = (key: string, element: HTMLElement) => {
      if (element.querySelector(':scope > .ship-code-copy')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ship-code-copy';
      button.contentEditable = 'false';
      let timer: number | undefined;
      const show = (status: 'idle' | 'copied' | 'error') => {
        const label = t(`chatCode.${status}`);
        button.setAttribute('aria-label', label);
        button.title = label;
        button.innerHTML = status === 'copied' ? CHECK_ICON : COPY_ICON;
      };
      show('idle');
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = editor
          .getEditorState()
          .read(() => $getNodeByKey(key)?.getTextContent() ?? '');
        let copied = false;
        try {
          copied = await writeClipboardViaBridge(text);
        } catch {
          copied = false;
        }
        show(copied ? 'copied' : 'error');
        window.clearTimeout(timer);
        timer = window.setTimeout(() => show('idle'), 2000);
      });
      element.appendChild(button);
      added.add(button);
    };

    const unregister = editor.registerMutationListener(
      CodeNode,
      (mutations) => {
        for (const [key, mutation] of mutations) {
          if (mutation === 'destroyed') continue;
          const element = editor.getElementByKey(key);
          if (element) attach(key, element);
        }
      },
      { skipInitialization: false }
    );

    return () => {
      unregister();
      for (const button of added) button.remove();
      added.clear();
    };
  }, [editor, t]);

  return null;
}
