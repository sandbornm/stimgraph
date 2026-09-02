export async function readNdjson<T>(
  response: Response,
  onEvent: (event: T) => void | Promise<void>,
) {
  if (!response.body) throw new Error('The server returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      await onEvent(JSON.parse(trimmed) as T);
    }
  }
  const leftover = buffer.trim();
  if (leftover) await onEvent(JSON.parse(leftover) as T);
}
