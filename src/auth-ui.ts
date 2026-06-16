// Sign-in UI: header controls + a dialog offering Google, email+password, and
// magic-link sign-in. Calls back with the current user on every auth change.
import type { User } from '@supabase/supabase-js';
import { cloudEnabled } from './cloud/supabase';
import {
  onAuthChange,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
  signInWithMagicLink,
  signOut,
} from './cloud/auth';

export function initAuth(onUser: (user: User | null) => void): void {
  const account = document.querySelector<HTMLDivElement>('#account')!;
  if (!cloudEnabled) {
    account.hidden = true; // No backend configured — stay local-only.
    return;
  }
  account.hidden = false;

  const signinBtn = document.querySelector<HTMLButtonElement>('#signin-btn')!;
  const signoutBtn = document.querySelector<HTMLButtonElement>('#signout-btn')!;
  const emailLabel = document.querySelector<HTMLSpanElement>('#account-email')!;
  const dialog = document.querySelector<HTMLDialogElement>('#auth-dialog')!;
  const emailInput = document.querySelector<HTMLInputElement>('#auth-email')!;
  const passwordInput = document.querySelector<HTMLInputElement>('#auth-password')!;
  const message = document.querySelector<HTMLParagraphElement>('#auth-message')!;

  const setMessage = (text: string, isError = false) => {
    message.textContent = text;
    message.classList.toggle('error', isError);
  };
  const run = async (fn: () => Promise<string | void>) => {
    setMessage('Working…');
    try {
      const result = await fn();
      setMessage(typeof result === 'string' ? result : '');
    } catch (err) {
      setMessage((err as Error).message, true);
    }
  };

  const emailSection = document.querySelector<HTMLDivElement>('#auth-email-section')!;
  const toggle = document.querySelector<HTMLButtonElement>('#auth-toggle')!;
  toggle.addEventListener('click', () => {
    emailSection.hidden = !emailSection.hidden;
    toggle.hidden = true; // once revealed, keep it open
  });

  signinBtn.addEventListener('click', () => {
    setMessage('');
    emailSection.hidden = true;
    toggle.hidden = false;
    dialog.showModal();
  });
  document.querySelector('#auth-close')!.addEventListener('click', () => dialog.close());
  document.querySelector('#auth-google')!.addEventListener('click', () => run(signInWithGoogle));
  document.querySelector('#auth-signin')!.addEventListener('click', () =>
    run(() => signInWithPassword(emailInput.value.trim(), passwordInput.value)),
  );
  document.querySelector('#auth-signup')!.addEventListener('click', () =>
    run(() => signUpWithPassword(emailInput.value.trim(), passwordInput.value)),
  );
  document.querySelector('#auth-magic')!.addEventListener('click', () =>
    run(() => signInWithMagicLink(emailInput.value.trim())),
  );
  signoutBtn.addEventListener('click', () => void signOut());

  onAuthChange((user) => {
    const signedIn = Boolean(user);
    signinBtn.hidden = signedIn;
    signoutBtn.hidden = !signedIn;
    emailLabel.hidden = !signedIn;
    emailLabel.textContent = user?.email ?? '';
    if (signedIn && dialog.open) dialog.close();
    onUser(user);
    // Supabase leaves the consumed OAuth tokens (or a bare '#') in the URL after
    // a redirect sign-in; tidy it up once the session has been parsed.
    if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  });
}
