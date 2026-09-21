export const REQUEST_TIMEOUT_MS = 10_000;

// A request that hung and one that was refused need different advice, and without a deadline
// a hung one leaves the form disabled with nothing on screen explaining why.
export function networkMessage(err: unknown): string {
  return err instanceof DOMException && err.name === 'TimeoutError'
    ? 'The server took too long to answer. Try again.'
    : 'Could not reach the server. Check your connection and try again.';
}
