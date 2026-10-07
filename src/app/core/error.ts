export function friendlyError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    const messages: Record<string, string> = {
      'auth/invalid-credential': 'The email or password was not accepted.',
      'auth/email-already-in-use': 'An account already uses that email. Try signing in.',
      'auth/weak-password': 'Choose a password with at least 8 characters.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Please try again later.',
      'auth/network-request-failed': 'Check your internet connection and try again.',
      'permission-denied': 'This change was not allowed. Refresh and check your account or campaign status.',
      'unavailable': 'The service is unavailable. Check your connection and try again.',
    };
    return messages[code] ?? 'The change could not be saved. Please try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
