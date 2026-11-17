import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { CodeNode } from '@lexical/code';
import { $getNodeByKey } from 'lexical';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { writeClipboardViaBridge } from '@/shared/lib/clipboard';

function CodeCopyButton({ onCopy }: { onCopy: () => Promise<boolean> }) {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    if (status === 'idle') return;
    const timer = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const label = t(`chatCode.${status}`);
  return (
    <button
      type="button"
      contentEditable={false}
      className="ship-code-copy"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          const copied = await onCopy();
          setStatus(copied ? 'copied' : 'error');
        } catch {
          setStatus('error');
        }
      }}
    >
      {status === 'copied' ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
      <span className="sr-only" role="status">
        {status !== 'idle' ? label : ''}
      </span>
    </button>
  );
}

/** Read-only code blocks: keep controls out of the serialized Lexical content. */
export function CodeCopyPlugin() {
  const [editor] = useLexicalComposerContext();
  const [blocks, setBlocks] = useState<Map<string, HTMLElement>>(new Map());
  useEffect(
    () =>
      editor.registerMutationListener(
        CodeNode,
        (mutations) => {
          setBlocks((previous) => {
            const next = new Map(previous);
            for (const [key, mutation] of mutations) {
              const element = editor.getElementByKey(key);
              if (mutation === 'destroyed' || !element) next.delete(key);
              else next.set(key, element);
            }
            return next;
          });
        },
        { skipInitialization: false }
      ),
    [editor]
  );
  return (
    <>
      {Array.from(blocks, ([key, element]) =>
        createPortal(
          <CodeCopyButton
            onCopy={async () => {
              const text = editor
                .getEditorState()
                .read(() => $getNodeByKey(key)?.getTextContent() ?? '');
              return writeClipboardViaBridge(text);
            }}
          />,
          element,
          key
        )
      )}
    </>
  );
}
