export async function finishNonStreamSync<T extends { error?: string }>(
  run: () => Promise<T>,
  label: () => Promise<unknown>,
): Promise<{ status: 200 | 502; result?: T; error?: string }> {
  try {
    const result = await run();
    if (result.error) return { status: 502, result, error: result.error };
    await label();
    return { status: 200, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bookmark sync failed.';
    return { status: 502, error: message };
  }
}
