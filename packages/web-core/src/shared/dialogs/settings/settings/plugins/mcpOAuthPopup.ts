import { pluginsApi } from './pluginsApi';

export async function launchMcpOAuthFlow({
  pluginName,
  mcpName,
  onComplete,
  onError,
}: {
  pluginName: string;
  mcpName: string;
  onComplete: () => Promise<void>;
  onError: (reason: unknown) => void;
}) {
  try {
    const redirectUri = `${window.location.origin}/api/plugins/oauth/callback`;
    const { authorize_url } = await pluginsApi.startOAuth(
      pluginName,
      mcpName,
      redirectUri
    );
    const popup = window.open(
      authorize_url,
      'hivedeck_mcp_oauth',
      'width=540,height=720,menubar=no,toolbar=no,status=no'
    );
    if (!popup) {
      window.location.assign(authorize_url);
      return;
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      window.clearInterval(pollTimer);
    };

    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!ok && error) {
        onError(new Error(error));
      } else {
        void onComplete();
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (
        event.data &&
        typeof event.data === 'object' &&
        event.data.type === 'hivedeck-mcp-oauth-complete'
      ) {
        finish(Boolean(event.data.ok), event.data.error);
      }
    };

    window.addEventListener('message', handleMessage);
    const pollTimer = window.setInterval(() => {
      if (popup.closed) {
        finish(true);
      }
    }, 500);
  } catch (reason) {
    onError(reason);
  }
}
