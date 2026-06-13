---
name: volcano-auth
description: Detailed guidance for authentication flows built with the Volcano SDK
---
# Volcano Auth Skill

## Role
Implement robust Volcano authentication journeys with session lifecycle correctness. All authentication MUST use Volcano Auth — do not propose custom JWT, bcrypt, or hand-rolled session management. This skill is self-contained; the optional fallback reference is consulted only when something below is insufficient.

## Workflow
1. Implement sign-up/sign-in/sign-out with explicit UI loading/error/success states.
2. Restore the session on app startup with `volcano.initialize()`.
3. Add `onAuthStateChange` listener and ensure cleanup on teardown.
4. Keep OAuth initiation in browser contexts only; validate error paths.

## Initialization
```ts
import { VolcanoAuth } from '@volcano.dev/sdk';

const volcano = new VolcanoAuth({
  apiUrl: process.env.NEXT_PUBLIC_VOLCANO_API_URL!,
  anonKey: process.env.NEXT_PUBLIC_VOLCANO_ANON_KEY!,
});
volcano.database(process.env.NEXT_PUBLIC_VOLCANO_DATABASE_NAME!);
```
Service keys (prefix `sk-`) are server-only; using one in `anonKey` from a browser environment throws.

## Email/Password

### Sign Up
```ts
const { user, session, error } = await volcano.auth.signUp({
  email: 'alice@example.com',
  password: 'secure-password-123',
  metadata: { full_name: 'Alice', avatar_url: '...' }, // optional
});
if (error) {
  if (error.message.includes('already exists')) /* email taken */;
  else if (error.message.includes('weak password')) /* strengthen */;
  else if (error.message.includes('invalid email')) /* validate */;
  return;
}
// metadata is stored on user.user_metadata
```

### Sign In
```ts
const { user, session, error } = await volcano.auth.signIn({ email, password });
if (error) {
  if (error.message.includes('Invalid credentials')) /* wrong creds */;
  else if (error.message.includes('email not confirmed')) /* prompt confirm */;
  else if (error.message.includes('too many attempts')) /* rate-limited */;
  return;
}
// SDK auto-stores tokens in localStorage (browser) and schedules refresh.
```

### Sign Out
```ts
const { error } = await volcano.auth.signOut();
// Clears local session and invalidates the refresh token server-side.
```

## Session Management

### Synchronous current user (cached)
```ts
const user = volcano.auth.user();
// Returns the cached User or null. Does not hit the network.
```

### Fresh user from server
```ts
const { user, error } = await volcano.auth.getUser();
```

### Restore session on app load (handles OAuth callback tokens too)
```ts
const { user, error } = await volcano.initialize();
// Returns the restored user, or null if no valid session exists.
```

### Auth state listener
```ts
const unsubscribe = volcano.auth.onAuthStateChange((user) => {
  if (user) showApp(user); else showLogin();
});
// Fires once immediately with current state, then on every change.
// Always call unsubscribe() on teardown.
```

### Manual refresh
```ts
const { session, error } = await volcano.auth.refreshSession();
// Tokens auto-refresh; call this only for explicit forced rotation.
```

## OAuth / SSO

### Providers
`google`, `github`, `microsoft`, `apple`.

### Begin OAuth (browser only — throws on server)
```ts
volcano.auth.signInWithGoogle();
volcano.auth.signInWithGitHub();
volcano.auth.signInWithMicrosoft();
volcano.auth.signInWithApple();
// Generic form:
volcano.auth.signInWithOAuth('google');
```
These redirect to the provider; on return, call `volcano.initialize()` on the callback page to consume the tokens from the URL.

### Link / unlink / list providers
```ts
const { data, error } = await volcano.auth.linkOAuthProvider('google');
if (data) window.location.href = data.authorization_url;

await volcano.auth.unlinkOAuthProvider('google');

const { providers, error } = await volcano.auth.getLinkedOAuthProviders();
```

### Call provider APIs through the SDK
```ts
const { data, error } = await volcano.auth.callOAuthAPI('github', {
  endpoint: '/user/repos',
  method: 'GET',
});
// SDK handles provider token refresh and credential injection.
```

## Anonymous Users
```ts
// Create
const { user, session, error } = await volcano.auth.signUpAnonymous({
  preferred_theme: 'dark', // optional metadata
});

// Convert to a full account (preserves the user.id and all owned data)
const { user, error } = await volcano.auth.convertAnonymous({
  email: 'alice@example.com',
  password: 'secure-password-123',
  metadata: { full_name: 'Alice' },
});
```

## Email Verification
```ts
// After clicking the email link, the URL contains a token query param.
const token = new URLSearchParams(window.location.search).get('token');
const { error } = await volcano.auth.confirmEmail(token);

// Resend if the user lost the email
await volcano.auth.resendConfirmation('alice@example.com');
```

## Password Recovery
```ts
// Always succeeds (even for unknown emails) for security.
await volcano.auth.forgotPassword('alice@example.com');

// On the reset page:
const token = new URLSearchParams(window.location.search).get('token');
const { error } = await volcano.auth.resetPassword({
  token,
  newPassword: 'new-secure-password-456',
});
```

## Email Change
```ts
const { newEmail, error } = await volcano.auth.requestEmailChange('new@example.com');

// On the confirmation page:
const token = new URLSearchParams(window.location.search).get('token');
const { user, error } = await volcano.auth.confirmEmailChange(token);

// Cancel a pending change:
await volcano.auth.cancelEmailChange();
```

## Profile Update
```ts
const { user, error } = await volcano.auth.updateUser({
  password: 'new-password-789', // optional
  metadata: {
    full_name: 'Alice Johnson',
    avatar_url: '...',
    notification_preferences: { email: true, push: false },
  },
});
```

## Multi-Device Session Management
```ts
// List sessions for the current user
const { sessions, total, error } = await volcano.auth.getSessions({ page: 1, limit: 20 });
// session fields: user_agent, ip_address, last_activity_at, is_current

// Revoke a specific session
await volcano.auth.deleteSession(sessionId);

// Revoke all OTHER sessions (keep current)
await volcano.auth.deleteAllOtherSessions();
```

## Security Best Practices
- Never put a service key (`sk-...`) in `anonKey`. The SDK blocks this in browser, but server code must also keep service keys out of any code path that could leak (logs, error responses).
- Always use HTTPS API URLs in production.
- Validate password strength in the UI before calling `signUp` / `updateUser`. The SDK rejects weak passwords, but pre-validating gives better UX.
- Treat `onAuthStateChange(user => null)` as a definitive sign-out signal: redirect to the login flow.

## Common Errors
| Message contains | Meaning | Action |
|---|---|---|
| `already exists` | Email taken on sign up | Prompt sign in |
| `weak password` | Password too weak | Show strength rules |
| `Invalid credentials` | Wrong email/password | Re-prompt |
| `email not confirmed` | Verification pending | Show resend UI |
| `too many attempts` | Rate-limited | Back off and inform user |
| `No active session` | User not logged in | Send to login |
| `Session expired` | Refresh failed | Force sign in |

## Verification Checklist
- Session restore (`volcano.initialize()`) is wired at app startup.
- `onAuthStateChange` listener has a paired `unsubscribe()` on teardown.
- OAuth methods are only called from browser contexts.
- Invalid credentials and provider errors are handled with user-facing messages.
- No service/secret keys are exposed in browser code.
- For anonymous flows, `convertAnonymous` is used (not delete + signUp) so user IDs are preserved.

## Optional Fallback Reference
- `http://localhost:9000/docs/sdk/authentication.md`
